import { hooks } from "./engine";
import "./victory";
import { doc, getDoc, onSnapshot, runTransaction, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { startGame } from "./engine";
import type { EffectAction, GameState, Room } from "./types";
import { runEffect } from "../effects/runtime";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
const roomRef = (code: string) => doc(db, "rooms", code);

export async function createRoom(uid: string, name: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    if ((await getDoc(roomRef(code))).exists()) continue;
    const room: Room = {
      code, hostUid: uid, auto: true, status: "lobby", createdAt: Date.now(), game: null,
      players: { [uid]: { uid, name, team: "", deck: null, joinedAt: Date.now() } },
    };
    await setDoc(roomRef(code), room);
    return code;
  }
  throw new Error("Impossible de créer un salon, réessaie.");
}

export async function joinRoom(code: string, uid: string, name: string): Promise<void> {
  await update(code, (room) => {
    const existing = room.players[uid];
    room.players[uid] = existing ? { ...existing, name } : { uid, name, team: "", deck: null, joinedAt: Date.now() };
    // Arrivé en cours de partie : spectateur.
    if (!existing && room.game) room.game.spectators.push(uid);
  });
}

export function watchRoom(code: string, cb: (r: Room | null) => void, onError: (e: Error) => void) {
  return onSnapshot(roomRef(code), (s) => cb(s.exists() ? (s.data() as Room) : null), onError);
}

/** Applique une modification à l'état du salon dans une transaction (sûr avec plusieurs joueurs). */
export async function update(code: string, fn: (room: Room) => void): Promise<void> {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists()) throw new Error("Ce salon n'existe pas.");
    const room = structuredClone(snap.data()) as Room;
    fn(room);
    tx.set(roomRef(code), room);
  });
}

/** Raccourci pour une action en jeu. */
export function act(code: string, fn: (room: Room, g: GameState) => void) {
  return update(code, (room) => {
    if (!room.game) return;
    fn(room, room.game);
    hooks.after?.(room, room.game);
  });
}

/** Action résolue automatiquement (mode auto), ou réponse au choix en attente. */
export function effect(code: string, action: EffectAction | null, answer?: unknown) {
  return update(code, (room) => runEffect(room, action, answer));
}

export function launch(code: string) {
  return update(code, (room) => {
    const late = Object.values(room.players).filter((p) => p.uid !== room.hostUid && !p.ready);
    if (late.length) throw new Error(`Pas encore prêt : ${late.map((p) => p.name).join(", ")}.`);
    room.game = startGame(room);
    room.status = "playing";
  });
}

export function backToLobby(code: string) {
  return update(code, (room) => {
    room.game = null;
    room.status = "lobby";
    for (const p of Object.values(room.players)) p.ready = false;
  });
}
