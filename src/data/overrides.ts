// Modifications faites depuis l'Atelier (#/admin) : textes des cartes, decks, images, voix et sons.
// Elles sont gardées dans Firestore (document content/live + un document par fichier dans assets/)
// et appliquées au chargement du site, par-dessus cards.json et les fichiers du projet.
import { doc, getDoc, type Firestore } from "firebase/firestore";
import { CARDS, CUSTOM_URLS, DECKS, type CardDef, type DeckDef, type Tags } from "./cards";

/** Champs d'une carte modifiables depuis l'Atelier. */
export type CardEdit = {
  name?: string;
  text?: string;
  rules?: string;
  tags?: Tags;
  /** affichage du déclenchement (modifiable seulement pour les cartes créées dans l'Atelier) */
  trigger?: string;
  event?: string;
  target?: string;
  /** image remplacée (date du changement, sert à ne pas recharger un fichier déjà en cache) */
  img?: number;
  /** voiceline remplacée (date), ou -1 = voiceline coupée */
  voice?: number;
};
/** Champs d'un deck modifiables depuis l'Atelier. */
export type DeckEdit = {
  description?: string;
  summary?: string;
  keywords?: string[];
  difficulty?: string;
  color?: string;
  inGame?: boolean;
  cards?: string[];
  vcs?: string[];
  /** dos des cartes remplacé (date) */
  back?: number;
};
export type Content = {
  cards?: Record<string, CardEdit>;
  decks?: Record<string, DeckEdit>;
  /** sons du jeu remplacés : nom du son → date */
  sfx?: Record<string, number>;
  /** volume des sons remplacés (0 à 1, 0,8 par défaut) */
  sfxVol?: Record<string, number>;
  /** cartes créées dans l'Atelier (leur version de départ ; les retouches vont dans `cards` comme pour les autres) */
  newCards?: Record<string, CardDef>;
  updatedAt?: number;
};

export const CARD_FIELDS = ["name", "text", "rules", "tags", "trigger", "event", "target"] as const;
/** Volume par défaut d'un son remplacé. */
export const SFX_GAIN = 0.8;
export const DECK_FIELDS = ["description", "summary", "keywords", "difficulty", "color", "inGame", "cards", "vcs"] as const;

/** Version d'origine (cards.json), pour pouvoir revenir en arrière. */
export const ORIGINAL_CARDS: Record<string, CardDef> = structuredClone(CARDS);
export const ORIGINAL_DECKS: DeckDef[] = structuredClone(DECKS);

/** Contenu actuellement appliqué. */
export let CONTENT: Content = {};

/** Version de départ d'une carte : celle de cards.json, ou celle de sa création dans l'Atelier. */
export const baseCard = (id: string): CardDef | undefined => ORIGINAL_CARDS[id] ?? CONTENT.newCards?.[id];
/** Carte créée dans l'Atelier (pas dans cards.json). */
export const isNewCard = (id: string) => !ORIGINAL_CARDS[id] && !!CONTENT.newCards?.[id];

/** Applique (ou ré-applique) les modifications : on repart toujours de l'original. */
export function applyContent(c: Content) {
  CONTENT = c;
  // Cartes créées : ajoutées au catalogue (et retirées si elles ont été supprimées).
  for (const id of Object.keys(CARDS)) if (!ORIGINAL_CARDS[id] && !c.newCards?.[id]) delete CARDS[id];
  for (const [id, def] of Object.entries(c.newCards ?? {})) {
    if (ORIGINAL_CARDS[id]) continue;
    const e = c.cards?.[id] ?? {};
    CARDS[id] = structuredClone({ ...def, id, image: "", claude: "" });
    for (const f of CARD_FIELDS) if (e[f] !== undefined) (CARDS[id] as Record<string, unknown>)[f] = structuredClone(e[f]);
  }
  for (const [id, orig] of Object.entries(ORIGINAL_CARDS)) {
    const e = c.cards?.[id] ?? {};
    const cur = CARDS[id];
    Object.assign(cur, structuredClone(orig));
    for (const f of CARD_FIELDS) if (e[f] !== undefined) (cur as Record<string, unknown>)[f] = structuredClone(e[f]);
  }
  for (const orig of ORIGINAL_DECKS) {
    const cur = DECKS.find((d) => d.name === orig.name);
    if (!cur) continue;
    const e = c.decks?.[orig.name] ?? {};
    Object.assign(cur, structuredClone(orig));
    for (const f of DECK_FIELDS) if (e[f] !== undefined) (cur as Record<string, unknown>)[f] = structuredClone(e[f]);
    // Une carte ne peut être que dans son propre deck.
    cur.cards = cur.cards.filter((id) => CARDS[id]?.deck === orig.name && CARDS[id].kind === "card");
    cur.vcs = cur.vcs.filter((id) => CARDS[id]?.deck === orig.name && CARDS[id].kind === "victory");
  }
}

/** Les fichiers remplacés que ce contenu utilise : clé → date du changement (-1 = fichier retiré). */
export function assetKeys(c: Content): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, e] of Object.entries(c.cards ?? {})) {
    if (e.img) out[`card~${id}`] = e.img;
    if (e.voice) out[`voice~${id}`] = e.voice;
  }
  for (const [name, e] of Object.entries(c.decks ?? {})) {
    const code = ORIGINAL_DECKS.find((d) => d.name === name)?.code;
    if (code && e.back) out[`back~${code}`] = e.back;
  }
  for (const [n, at] of Object.entries(c.sfx ?? {})) if (at) out[`sfx~${n}`] = at;
  return out;
}

/** Une voiceline coupée depuis l'Atelier. */
export const voiceRemoved = (id: string) => CONTENT.cards?.[id]?.voice === -1;

const CACHE = "tokards-assets";
const cacheUrl = (key: string, at: number) => `${location.origin}/__tokards-asset/${encodeURIComponent(key)}?v=${at}`;

/** Fichier stocké en base64 dans Firestore → Blob. */
export function b64ToBlob(data: string, mime: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Charge un fichier remplacé (cache du navigateur d'abord, Firestore sinon) et le rend utilisable par le jeu. */
export async function loadAsset(db: Firestore, key: string, at: number): Promise<void> {
  if (at < 0) {
    delete CUSTOM_URLS[key];
    return;
  }
  let blob: Blob | null = null;
  const cache = "caches" in window ? await caches.open(CACHE).catch(() => null) : null;
  const hit = await cache?.match(cacheUrl(key, at)).catch(() => undefined);
  if (hit) blob = await hit.blob();
  if (!blob) {
    const s = await getDoc(doc(db, "assets", key));
    if (!s.exists()) return;
    const { data, mime } = s.data() as { data: string; mime: string };
    blob = b64ToBlob(data, mime);
    void cache?.put(cacheUrl(key, at), new Response(blob, { headers: { "Content-Type": mime } })).catch(() => {});
  }
  const old = CUSTOM_URLS[key];
  CUSTOM_URLS[key] = URL.createObjectURL(blob);
  if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
}

/** Retire les fichiers qui ne sont plus utilisés par le contenu. */
export function dropUnused(c: Content) {
  const keep = assetKeys(c);
  for (const k of Object.keys(CUSTOM_URLS)) if (!keep[k] || keep[k] < 0) delete CUSTOM_URLS[k];
}

/** Au démarrage du site : lit les modifications et leurs fichiers. Ne bloque jamais le site (erreurs ignorées). */
export async function loadContent(db: Firestore): Promise<void> {
  try {
    const s = await getDoc(doc(db, "content", "live"));
    const c = (s.exists() ? s.data() : {}) as Content;
    applyContent(c);
    await Promise.all(Object.entries(assetKeys(c)).map(([k, at]) => loadAsset(db, k, at).catch(() => {})));
  } catch {
    /* hors ligne ou base injoignable : on garde le contenu d'origine */
  }
}
