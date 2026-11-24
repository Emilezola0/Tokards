// Atelier : connexion Google (séparée de l'identité anonyme du jeu), rôles et écritures dans Firestore.
import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence, browserPopupRedirectResolver, connectAuthEmulator, GoogleAuthProvider, indexedDBLocalPersistence,
  initializeAuth, onAuthStateChanged, signInWithPopup, signOut, type User,
} from "firebase/auth";
import {
  addDoc, collection, connectFirestoreEmulator, deleteDoc, deleteField, doc, FieldPath, getDoc, getFirestore, limit,
  onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp, writeBatch,
} from "firebase/firestore";
import { app } from "../firebase";
import type { CardEdit, Content, DeckEdit } from "../data/overrides";

// Une seconde instance Firebase : se connecter à l'Atelier ne change pas l'identité de joueur (salons en cours).
const adminApp = initializeApp(app.options, "atelier");
export const adminAuth = initializeAuth(adminApp, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  popupRedirectResolver: browserPopupRedirectResolver,
});
export const adminDb = getFirestore(adminApp);
if (import.meta.env.MODE === "emulator") {
  connectAuthEmulator(adminAuth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(adminDb, "127.0.0.1", 8080);
}

export type Role = "owner" | "editor";
export type Member = { uid: string; role: Role; name: string; email: string; photo: string; since?: Timestamp; invite?: string };
export type Invite = { code: string; by: string; byName: string; createdAt?: Timestamp; expiresAt: Timestamp; note: string };
export type HistoryEntry = { id: string; by: string; name: string; what: string; at?: Timestamp };

export const ROLE_LABEL: Record<Role, string> = { owner: "👑 Propriétaire", editor: "✏️ Éditeur" };

export const watchUser = (cb: (u: User | null) => void) => onAuthStateChanged(adminAuth, cb);
export const login = () => signInWithPopup(adminAuth, new GoogleAuthProvider());
export const logout = () => signOut(adminAuth);

const me = () => {
  const u = adminAuth.currentUser;
  if (!u) throw new Error("Connecte-toi d'abord.");
  return u;
};
const profile = (u: User) => ({ name: u.displayName ?? u.email ?? "Sans nom", email: u.email ?? "", photo: u.photoURL ?? "" });

/** Membre de l'équipe (null = pas encore admis). */
export function watchMember(uid: string, cb: (m: Member | null) => void) {
  return onSnapshot(doc(adminDb, "admins", uid), (s) => cb(s.exists() ? ({ uid, ...s.data() } as Member) : null), () => cb(null));
}
/** Le site a-t-il déjà un propriétaire ? */
export async function hasOwner(): Promise<boolean> {
  return (await getDoc(doc(adminDb, "config", "owner"))).exists();
}
/** Premier passage : la personne connectée devient propriétaire (possible une seule fois). */
export async function claimOwner() {
  const u = me();
  const b = writeBatch(adminDb);
  b.set(doc(adminDb, "admins", u.uid), { role: "owner", ...profile(u), since: serverTimestamp() });
  b.set(doc(adminDb, "config", "owner"), { uid: u.uid });
  await b.commit();
}
/** Rejoint l'équipe avec un code d'invitation (le code ne sert qu'une fois). */
export async function joinWithInvite(code: string) {
  const u = me();
  const b = writeBatch(adminDb);
  b.set(doc(adminDb, "admins", u.uid), { role: "editor", ...profile(u), since: serverTimestamp(), invite: code });
  b.delete(doc(adminDb, "invites", code));
  try {
    await b.commit();
  } catch {
    throw new Error("Invitation invalide, déjà utilisée ou expirée. Demande un nouveau lien.");
  }
}

// ——— Équipe ———
export const watchMembers = (cb: (m: Member[]) => void) =>
  onSnapshot(collection(adminDb, "admins"), (s) => cb(s.docs.map((d) => ({ uid: d.id, ...d.data() }) as Member)));
export const setRole = (uid: string, role: Role) => setDoc(doc(adminDb, "admins", uid), { role }, { merge: true });
export const removeMember = (uid: string) => deleteDoc(doc(adminDb, "admins", uid));

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export async function createInvite(note: string, days = 7): Promise<string> {
  const u = me();
  const code = Array.from(crypto.getRandomValues(new Uint8Array(10)), (n) => ALPHABET[n % ALPHABET.length]).join("");
  await setDoc(doc(adminDb, "invites", code), {
    by: u.uid, byName: u.displayName ?? "", note: note.slice(0, 80), createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + days * 86400e3),
  });
  return code;
}
export const watchInvites = (cb: (i: Invite[]) => void) =>
  onSnapshot(collection(adminDb, "invites"), (s) => cb(s.docs.map((d) => ({ code: d.id, ...d.data() }) as Invite)), () => cb([]));
export const deleteInvite = (code: string) => deleteDoc(doc(adminDb, "invites", code));
export const inviteLink = (code: string) => `${location.origin}${location.pathname}#/admin/${code}`;

// ——— Contenu ———
const LIVE = () => doc(adminDb, "content", "live");
export const watchContent = (cb: (c: Content) => void, onError?: (e: Error) => void) =>
  onSnapshot(LIVE(), (s) => cb((s.exists() ? s.data() : {}) as Content), onError);

async function logChange(what: string) {
  const u = me();
  await addDoc(collection(adminDb, "history"), { by: u.uid, name: u.displayName ?? "?", what: what.slice(0, 300), at: serverTimestamp() });
}
export const watchHistory = (cb: (h: HistoryEntry[]) => void) =>
  onSnapshot(query(collection(adminDb, "history"), orderBy("at", "desc"), limit(60)), (s) =>
    cb(s.docs.map((d) => ({ id: d.id, ...d.data() }) as HistoryEntry)),
  );

/** Remplace (ou efface si vide) les modifications d'une carte, d'un deck ou des sons. */
async function writeEntry(section: "cards" | "decks" | "sfx", key: string, value: unknown, what: string) {
  const path = new FieldPath(section, key);
  const empty = value === undefined || (typeof value === "object" && value !== null && !Object.keys(value).length);
  await setDoc(LIVE(), { [section]: { [key]: empty ? deleteField() : value }, updatedAt: Date.now() }, { mergeFields: [path, "updatedAt"] });
  await logChange(what);
}
export const saveCard = (id: string, e: CardEdit, what: string) => writeEntry("cards", id, e, what);
export const saveDeck = (name: string, e: DeckEdit, what: string) => writeEntry("decks", name, e, what);
export const saveSfx = (name: string, at: number | undefined, what: string) => writeEntry("sfx", name, at, what);

// ——— Fichiers ———
/** Taille max d'un fichier (il est stocké en base64 dans un document Firestore, limité à 1 Mo). */
export const MAX_FILE = 700 * 1024;

const toB64 = (blob: Blob) =>
  new Promise<string>((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => ko(r.error);
    r.readAsDataURL(blob);
  });

/** Envoie un fichier (déjà préparé) sous la clé donnée. Renvoie la date à enregistrer dans le contenu. */
export async function uploadAsset(key: string, blob: Blob): Promise<number> {
  if (blob.size > MAX_FILE) throw new Error(`Fichier trop lourd (${Math.round(blob.size / 1024)} Ko, max ${MAX_FILE / 1024} Ko).`);
  const u = me();
  await setDoc(doc(adminDb, "assets", key), { data: await toB64(blob), mime: blob.type || "application/octet-stream", size: blob.size, by: u.uid, at: serverTimestamp() });
  return Date.now();
}
export const deleteAsset = (key: string) => deleteDoc(doc(adminDb, "assets", key)).catch(() => {});

/** Image → WebP redimensionnée (max `maxW` × `maxH`), pour rester légère. */
export async function prepareImage(file: File, maxW = 600, maxH = 900): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Ce fichier n'est pas une image.");
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxW / bmp.width, maxH / bmp.height);
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  for (const q of [0.86, 0.75, 0.6, 0.45]) {
    const b = await new Promise<Blob | null>((r) => c.toBlob(r, "image/webp", q));
    if (b && b.size <= MAX_FILE) return b;
  }
  throw new Error("Image trop lourde même compressée : essaie une image plus petite.");
}

/** Son : vérifié tel quel (mp3, ogg, wav, m4a, webm). */
export function prepareAudio(file: File): Blob {
  if (!file.type.startsWith("audio/") && !/\.(mp3|ogg|wav|m4a|webm)$/i.test(file.name)) throw new Error("Ce fichier n'est pas un son.");
  if (file.size > MAX_FILE) throw new Error(`Son trop lourd (${Math.round(file.size / 1024)} Ko, max ${MAX_FILE / 1024} Ko). Raccourcis-le ou exporte-le en MP3.`);
  return file;
}
