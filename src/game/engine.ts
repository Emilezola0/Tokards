// Moteur de la table virtuelle : fonctions pures qui modifient l'état du salon.
// Les effets des cartes ne sont pas automatisés : les joueurs les appliquent avec les outils manuels.
import { BASE_VCS, DECKS, card } from "../data/cards";
import type { BlackHole, GameState, PlayerState, Room, Vote, Zone } from "./types";
import { blackHoleLabel, ZONE_LABEL } from "./types";

export const START_GOLD = 10;
export const HAND_SIZE = 4;
const LOG_MAX = 250;

/** Source de hasard : remplacée pendant la résolution d'un effet pour pouvoir la rejouer à l'identique. */
export const RNG = { next: Math.random };

export function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(RNG.next() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}
export const roll = (faces: number) => 1 + Math.floor(RNG.next() * faces);

/** Hôpital du Dr. Goblinstein : tant qu'il est sur le terrain, la défausse de son joueur va au fond de sa pioche. */
const HOSPITAL = "GOB-30";

export const nameOf = (room: Room, uid: string) => room.players[uid]?.name ?? "?";
export const teamKey = (room: Room, uid: string) => room.players[uid]?.team.trim() || `solo:${uid}`;
export const teamLabel = (room: Room, key: string) =>
  key.startsWith("solo:") ? nameOf(room, key.slice(5)) : `Équipe ${key}`;
export const teamMembers = (room: Room, key: string) =>
  (room.game?.order ?? []).filter((u) => teamKey(room, u) === key);
export const currentPlayer = (g: GameState) => g.order[g.turn];

export function log(g: GameState, text: string) {
  g.log.push({ ts: Date.now(), text });
  if (g.log.length > LOG_MAX) g.log.splice(0, g.log.length - LOG_MAX);
}

// ---------- Mise en place ----------

export function startGame(room: Room): GameState {
  const lobby = Object.values(room.players).sort((a, b) => a.joinedAt - b.joinedAt);
  const playing = lobby.filter((p) => p.deck);
  const spectators = lobby.filter((p) => !p.deck).map((p) => p.uid);

  // Ordre : chacun lance un d20, le plus gros commence (égalité départagée au hasard).
  const rolls: Record<string, number> = {};
  const tiebreak: Record<string, number> = {};
  for (const p of playing) {
    rolls[p.uid] = roll(20);
    tiebreak[p.uid] = Math.random();
  }
  const order = playing
    .map((p) => p.uid)
    .sort((a, b) => rolls[b] - rolls[a] || tiebreak[b] - tiebreak[a]);

  const g: GameState = {
    order, spectators, rolls, turn: 0, round: 1, phase: "activation", activated: [], pending: null, fx: [], fxSeq: 0,
    actionsLeft: 1,
    handSize: HAND_SIZE, players: {}, owner: {}, commonVC: "", vcPile: [], commonDone: [], ranking: [],
    vote: null, log: [],
  };
  log(g, `Lancers de d20 : ${order.map((u) => `${nameOf(room, u)} ${rolls[u]}`).join(", ")}.`);

  let vcPool = [...BASE_VCS];
  for (const uid of order) {
    const deck = DECKS.find((d) => d.name === room.players[uid].deck)!;
    vcPool = vcPool.concat(deck.vcs);
    const pile = shuffle(deck.cards);
    for (const id of deck.cards) g.owner[id] = uid;
    g.players[uid] = {
      gold: START_GOLD, sentience: true, blackHole: "Primordial", allowNegativeGold: false,
      deck: pile.slice(HAND_SIZE), hand: pile.slice(0, HAND_SIZE), terrain: [], discard: [],
      personalVC: null, personalDone: false,
    };
  }
  vcPool = shuffle(vcPool);
  g.commonVC = vcPool.shift()!;
  log(g, `Condition de victoire commune : « ${card(g.commonVC).name} ».`);
  for (const uid of order) {
    g.players[uid].personalVC = vcPool.shift() ?? null;
  }
  g.vcPile = vcPool;
  log(g, `Ordre du tour : ${order.map((u) => nameOf(room, u)).join(" → ")}.`);
  beginTurn(room, g);
  return g;
}

function beginTurn(room: Room, g: GameState) {
  const uid = currentPlayer(g);
  const p = g.players[uid];
  p.goldGainedLastTurn = p.goldGainedSince ?? 0;
  p.goldGainedSince = 0;
  g.activated = [];
  g.actionsLeft = 1;
  g.phase = p.terrain.length ? "activation" : "action";
  log(g, `— Tour ${g.round} : à ${nameOf(room, uid)} de jouer.`);
}

// ---------- Déroulé du tour ----------

/** Prochaine carte à activer : la première du terrain (sens de lecture) pas encore activée ce tour. */
export function nextActivation(g: GameState): string | undefined {
  const done = g.activated ?? [];
  return g.players[currentPlayer(g)].terrain.find((id) => !done.includes(id));
}

export function activationStep(room: Room, g: GameState, applied: boolean) {
  const uid = currentPlayer(g);
  const id = nextActivation(g);
  if (id) {
    log(g, `${nameOf(room, uid)} ${applied ? "active" : "ne peut pas activer"} « ${card(id).name} ».`);
    g.activated = [...(g.activated ?? []), id];
  }
  if (!nextActivation(g)) g.phase = "action";
}

export function skipActivation(room: Room, g: GameState) {
  log(g, `${nameOf(room, currentPlayer(g))} passe à la phase de pose.`);
  g.phase = "action";
}

export function consumeAction(g: GameState) {
  g.actionsLeft = Math.max(0, g.actionsLeft - 1);
  if (g.actionsLeft === 0) g.phase = "end";
}

export function grantExtraAction(room: Room, g: GameState) {
  g.actionsLeft++;
  g.phase = "action";
  log(g, `${nameOf(room, currentPlayer(g))} obtient une action supplémentaire (effet de carte).`);
}

export function endTurn(room: Room, g: GameState) {
  const uid = currentPlayer(g);
  const p = g.players[uid];
  const need = Math.max(0, g.handSize - p.hand.length);
  const drawn = drawCards(g, uid, need);
  log(g, `${nameOf(room, uid)} termine son tour${drawn ? ` et pioche ${drawn} carte${drawn > 1 ? "s" : ""}` : ""}.`);
  g.turn = (g.turn + 1) % g.order.length;
  if (g.turn === 0) g.round++;
  beginTurn(room, g);
}

// ---------- Cartes ----------

export function locate(g: GameState, id: string): { uid: string; zone: Zone; index: number } | null {
  for (const [uid, p] of Object.entries(g.players)) {
    for (const zone of ["hand", "terrain", "discard", "deck"] as Zone[]) {
      const index = p[zone].indexOf(id);
      if (index >= 0) return { uid, zone, index };
    }
  }
  return null;
}

/** Remélange la défausse pour reformer la pioche si besoin. Retourne false si rien à piocher. */
function ensureDeck(g: GameState, uid: string): boolean {
  const p = g.players[uid];
  if (p.deck.length) return true;
  if (!p.discard.length) return false;
  p.deck = shuffle(p.discard);
  p.discard = [];
  log(g, `La défausse est remélangée pour reformer une pioche.`);
  return true;
}

/** Pioche n cartes de la pioche de `from` (par défaut la sienne) vers la main de `uid`. */
export function drawCards(g: GameState, uid: string, n: number, from = uid): number {
  let k = 0;
  for (; k < n; k++) {
    if (!ensureDeck(g, from)) break;
    g.players[uid].hand.push(g.players[from].deck.shift()!);
  }
  return k;
}

export type Dest = { uid: string; zone: Zone; index?: number; bottom?: boolean };

export function moveCard(room: Room, g: GameState, id: string, dest: Dest, quiet = false) {
  const at = locate(g, id);
  if (!at) return;
  if (dest.zone === "discard" && id !== HOSPITAL && g.players[dest.uid].terrain.includes(HOSPITAL)) {
    log(g, `🏥 Hôpital du Dr. Goblinstein : « ${card(id).name} » va au fond de la pioche au lieu de la défausse.`);
    dest = { uid: dest.uid, zone: "deck", bottom: true };
  }
  const from = g.players[at.uid][at.zone];
  from.splice(at.index, 1);
  const to = g.players[dest.uid][dest.zone];
  let index = dest.index ?? (dest.zone === "deck" ? (dest.bottom ? to.length : 0) : to.length);
  if (dest.zone === "discard" && dest.index === undefined) index = 0; // dessus de la défausse = index 0
  // Un déplacement dans la même zone vers la droite décale l'index après suppression.
  if (at.uid === dest.uid && at.zone === dest.zone && dest.index !== undefined && dest.index > at.index) index--;
  to.splice(Math.max(0, Math.min(index, to.length)), 0, id);
  if (!quiet) {
    const hidden = at.zone === "hand" || at.zone === "deck";
    const label = hidden && dest.zone !== "terrain" && dest.zone !== "discard" ? "une carte" : `« ${card(id).name} »`;
    const where =
      dest.zone === "deck" ? `${dest.bottom ? "au fond de" : "sur"} la pioche` : `${dest.zone === "terrain" ? "sur le" : "dans la"} ${ZONE_LABEL[dest.zone]}`;
    log(g, `${label} : ${ZONE_LABEL[at.zone]} de ${nameOf(room, at.uid)} → ${where} de ${nameOf(room, dest.uid)}.`);
  }
}

export function playFromHand(room: Room, g: GameState, uid: string, id: string, target: string, index: number) {
  moveCard(room, g, id, { uid: target, zone: "terrain", index }, true);
  const where = target === uid ? `en position ${index + 1}` : `sur le terrain de ${nameOf(room, target)}, position ${index + 1}`;
  log(g, `${nameOf(room, uid)} pose « ${card(id).name} » ${where}.`);
  if (uid === currentPlayer(g) && g.phase === "action") consumeAction(g);
}

export function discardFromHand(room: Room, g: GameState, uid: string, id: string) {
  const owner = g.owner[id] ?? uid;
  moveCard(room, g, id, { uid: owner, zone: "discard" }, true);
  log(g, `${nameOf(room, uid)} défausse « ${card(id).name} » de sa main.`);
  if (uid === currentPlayer(g) && g.phase === "action") consumeAction(g);
}

export function takeRandomFromHand(room: Room, g: GameState, from: string, to: string) {
  const hand = g.players[from].hand;
  if (!hand.length) return;
  const id = hand[Math.floor(Math.random() * hand.length)];
  moveCard(room, g, id, { uid: to, zone: "hand" }, true);
  log(g, `${nameOf(room, to)} prend une carte au hasard dans la main de ${nameOf(room, from)}.`);
}

export function shuffleDeck(room: Room, g: GameState, uid: string, withDiscard: boolean) {
  const p = g.players[uid];
  if (withDiscard) {
    p.deck = p.deck.concat(p.discard);
    p.discard = [];
  }
  p.deck = shuffle(p.deck);
  log(g, `${nameOf(room, uid)} mélange sa pioche${withDiscard ? " avec sa défausse" : ""}.`);
}

// ---------- Ressources ----------

export function changeGold(room: Room, g: GameState, uid: string, delta: number) {
  const p = g.players[uid];
  const before = p.gold;
  p.gold = Math.trunc(p.gold + delta);
  if (!p.allowNegativeGold) p.gold = Math.max(0, p.gold);
  if (p.gold > before) p.goldGainedSince = (p.goldGainedSince ?? 0) + (p.gold - before);
  if (p.gold !== before) log(g, `${nameOf(room, uid)} : ${before} → ${p.gold} gold.`);
}

export function transferGold(room: Room, g: GameState, from: string, to: string, amount: number) {
  const a = g.players[from];
  const real = a.allowNegativeGold ? amount : Math.min(amount, Math.max(0, a.gold));
  a.gold -= real;
  g.players[to].gold += real;
  g.players[to].goldGainedSince = (g.players[to].goldGainedSince ?? 0) + real;
  log(g, `${nameOf(room, from)} donne ${real} gold à ${nameOf(room, to)}.`);
}

export function setSentience(room: Room, g: GameState, uid: string, v: boolean) {
  g.players[uid].sentience = v;
  log(g, `${nameOf(room, uid)} : sentience ${v ? "Vraie" : "Fausse"}.`);
}

export function setBlackHole(room: Room, g: GameState, uid: string, b: BlackHole) {
  const before = g.players[uid].blackHole;
  g.players[uid].blackHole = b;
  log(g, `${nameOf(room, uid)} : trou noir ${blackHoleLabel(before)} → ${blackHoleLabel(b)}.`);
}

// ---------- Conditions de victoire ----------

export function teamHasWon(room: Room, g: GameState, key: string): boolean {
  if (!g.commonDone.includes(key)) return false;
  return teamMembers(room, key).every((u) => !g.players[u].personalVC || g.players[u].personalDone);
}

function checkVictory(room: Room, g: GameState, key: string) {
  if (g.ranking.some((r) => r.team === key) || !teamHasWon(room, g, key)) return;
  g.ranking.push({ team: key, round: g.round });
  log(g, `🏆 ${teamLabel(room, key)} remplit toutes ses conditions et termine ${g.ranking.length}${g.ranking.length === 1 ? "er" : "e"} !`);
  g.vote = {};
}

export function setCommonDone(room: Room, g: GameState, key: string, done: boolean) {
  g.commonDone = g.commonDone.filter((k) => k !== key);
  if (done) g.commonDone.push(key);
  log(g, `${teamLabel(room, key)} : condition commune ${done ? "remplie ✔" : "annulée"}.`);
  if (done) checkVictory(room, g, key);
}

export function setPersonalDone(room: Room, g: GameState, uid: string, done: boolean) {
  g.players[uid].personalDone = done;
  const vc = g.players[uid].personalVC;
  log(g, `${nameOf(room, uid)} : condition « ${vc ? card(vc).name : "?"} » ${done ? "remplie ✔" : "annulée"}.`);
  if (done) checkVictory(room, g, teamKey(room, uid));
}

export function castVote(g: GameState, uid: string, v: Vote) {
  if (!g.vote) g.vote = {};
  g.vote[uid] = v;
}

export type { PlayerState };
