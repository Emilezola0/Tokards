// Moteur de la table virtuelle : fonctions pures qui modifient l'état du salon.
// Les effets des cartes ne sont pas automatisés : les joueurs les appliquent avec les outils manuels.
import { BASE_VCS, DECKS, card } from "../data/cards";
import type { BlackHole, Fx, FxInput, GameState, LogEntry, Phase, PlayerState, Room, Stats, Until, Vote, Zone, Weather } from "./types";
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

const FX_KEEP = 80;

/** Compteurs d'un joueur (créés au besoin). */
export function st(p: PlayerState): Stats {
  if (!p.stats) p.stats = {};
  return p.stats;
}
/** Numéro de tour global (0, 1, 2… à chaque changement de joueur). */
export const pos = (g: GameState) => (g.round - 1) * g.order.length + g.turn;

/** Points d'accroche pour les conditions de victoire (renseignés par victory.ts). */
export const hooks: {
  turnEnd?: (room: Room, g: GameState, uid: string) => void;
  after?: (room: Room, g: GameState) => void;
  /** condition de victoire vérifiable automatiquement */
  vcOk?: (vc: string) => boolean;
  /** pioche de fin de tour (pour les passifs qui réagissent à la pioche) */
  drew?: (g: GameState, uid: string, n: number) => void;
} = {};

/** Partie en cours de résolution (pour les aides qui n'ont pas l'état sous la main). */
export const live: { g: GameState | null } = { g: null };

/** Tags d'une carte, avec le 🧠 ajouté jusqu'à la fin du tour (Transformers). */
export function tagsOf(g: GameState | null | undefined, id: string) {
  const t = card(id).tags;
  return g?.tempTags?.includes(id) ? { ...t, sentience: true } : t;
}

/** Drone de surveillance : désactive les cartes à la même position sur les terrains voisins. */
export const DRONE = "POL-23";
/** Orage (deck Météo) : le joueur qui l'a sur son terrain a la météo Orage. */
export const ORAGE = "MET-21";
/** Hôte fictif des cartes ensevelies sous la neige (Neige parfaite). */
export const SNOW = "NEIGE";
export function weatherOf(g: GameState, uid: string): Weather | null {
  const p = g.players[uid];
  if (!p) return null;
  if (p.terrain.includes(ORAGE)) return "Orage";
  return p.weather ?? null;
}

/** Voisins d'un joueur dans l'ordre du tour : [à gauche (précédent), à droite (suivant)]. */
export function neighbours(g: GameState, uid: string): [string, string] {
  const o = g.order;
  const i = o.indexOf(uid);
  return [o[(i - 1 + o.length) % o.length], o[(i + 1) % o.length]];
}

/** La carte est-elle désactivée (son effet et ses passifs ne fonctionnent pas) ? */
/** Voyant voyou voyeur : tant qu'il est actif sur un terrain, les cartes face cachée (sauf les mains) sont visibles. */
export const SEER = "VIC-16";
export function seeThrough(g: GameState): boolean {
  return Object.values(g.players).some((p) => p.terrain.includes(SEER)) && !isDisabled(g, SEER);
}

export function isDisabled(g: GameState, id: string): boolean {
  if (g.disabled?.[id]) return true;
  const at = locate(g, id);
  if (!at || at.zone !== "terrain" || g.order.length < 2) return false;
  for (const n of new Set(neighbours(g, at.uid))) {
    if (n === at.uid) continue;
    if (g.players[n].terrain[at.index] === DRONE && !g.disabled?.[DRONE]) return true;
  }
  return false;
}

/** Désactive une carte jusqu'à `until` (absent = jusqu'à nouvel ordre). */
export function disableCard(g: GameState, id: string, until?: Until) {
  g.disabled = { ...(g.disabled ?? {}), [id]: until ? { ...until } : {} };
}
export function enableCard(g: GameState, id: string) {
  if (!g.disabled?.[id]) return false;
  const d = { ...g.disabled };
  delete d[id];
  g.disabled = d;
  if (g.disabledBy?.[id]) {
    const b = { ...g.disabledBy };
    delete b[id];
    g.disabledBy = b;
  }
  return true;
}

/** Fin des états temporaires liés au début ou à la fin du tour de `uid`. */
function expire(room: Room, g: GameState, uid: string, edge: "start" | "end") {
  const P = pos(g);
  for (const [id, u] of Object.entries(g.disabled ?? {})) {
    if (u.uid !== uid || u.edge !== edge || P <= (u.after ?? Infinity)) continue;
    enableCard(g, id);
    log(g, `✅ « ${card(id).name} » est réactivée.`, { dst: id });
  }
  if (edge !== "end") return;
  // Rêve d'amitié / Cauchemar d'emprisonnement : la protection dure un seul tour de `by`.
  if (g.shields?.length) g.shields = g.shields.filter((s) => !(s.by === uid && P > s.after));
  if (g.tempTags?.length) g.tempTags = [];
  for (const t of (g.temp ?? []).filter((t) => t.uid === uid)) {
    const p = g.players[uid];
    if (t.kind === "bh") p.blackHole = t.prev as BlackHole;
    else p.sentience = t.prev === "true";
    log(g, `⏪ ${nameOf(room, uid)} retrouve ${t.kind === "bh" ? `son trou noir ${blackHoleLabel(t.prev as BlackHole)}` : `sa sentience ${t.prev === "true" ? "Vraie" : "Fausse"}`} (valeur provisoire terminée).`);
  }
  if (g.temp?.length) g.temp = g.temp.filter((t) => t.uid !== uid);
}

/** Change de phase en l'annonçant. */
export function setPhase(g: GameState, phase: Phase) {
  if (g.phase === phase) return;
  g.phase = phase;
  pushFx(g, { k: "phase", uid: currentPlayer(g), phase });
}
/** Ajoute un effet visuel à la file (joué par tous les clients). */
export function pushFx(g: GameState, f: FxInput) {
  g.fxSeq = (g.fxSeq ?? 0) + 1;
  g.fx = [...(g.fx ?? []), { ...f, id: g.fxSeq } as Fx].slice(-FX_KEEP);
}

export function log(g: GameState, text: string, extra?: Omit<LogEntry, "ts" | "text">) {
  const e: LogEntry = { ts: Date.now(), text };
  // Firestore refuse les champs undefined : on ne garde que ceux renseignés.
  for (const [k, v] of Object.entries(extra ?? {})) if (v != null) (e as unknown as Record<string, unknown>)[k] = v;
  g.log.push(e);
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
    vote: null, log: [], startedAt: Date.now(), lastPlayed: null,
  };
  for (const u of order) pushFx(g, { k: "dice", uid: u, faces: 20, value: rolls[u] });
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
      personalVC: null, personalDone: false, stats: { bhHist: [{ pos: 0, bh: "Primordial" }] },
    };
  }
  // Mode automatique : seules les conditions vérifiées automatiquement sont tirées.
  if (room.auto !== false && hooks.vcOk) vcPool = vcPool.filter(hooks.vcOk);
  vcPool = shuffle(vcPool);
  g.commonVC = vcPool.shift()!;
  log(g, `Condition de victoire commune : « ${card(g.commonVC).name} ».`);
  pushFx(g, { k: "vc", uid: null, card: g.commonVC });
  for (const uid of order) {
    const vc = vcPool.shift() ?? null;
    g.players[uid].personalVC = vc;
    if (vc) pushFx(g, { k: "vc", uid, card: vc });
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
  const s = st(p);
  s.bhTurn = 0;
  s.failed = 0; // « Inhibition toxique » se vérifie sur un seul tour
  s.spentTurn = 0;
  s.lostTurn = 0;
  if (p.cantPlay) delete p.cantPlay;
  if (p.cantPlayNext) {
    p.cantPlay = p.cantPlayNext;
    delete p.cantPlayNext;
  }
  if (p.locked) {
    p.locked = false;
    log(g, `🔓 ${nameOf(room, uid)} n'est plus bloqué.`);
  }
  g.phase = p.terrain.length ? "activation" : "action";
  g.lastPlayed = null;
  // Les cartes de son terrain peuvent rejouer leur effet.
  if (g.spent?.length) g.spent = g.spent.filter((id) => !p.terrain.includes(id));
  expire(room, g, uid, "start");
  pushFx(g, { k: "turn", uid });
  pushFx(g, { k: "phase", uid, phase: g.phase });
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
    pushFx(g, { k: "activate", card: id, uid });
    if (!applied) {
      pushFx(g, { k: "fail", card: id, uid });
      st(g.players[uid]).failed = (st(g.players[uid]).failed ?? 0) + 1;
    }
    g.activated = [...(g.activated ?? []), id];
    markSpent(g, id);
  }
  if (!nextActivation(g)) setPhase(g, "action");
}

/** La carte a joué son effet : elle reste marquée jusqu'au prochain tour du joueur qui l'a sur son terrain. */
export function markSpent(g: GameState, id: string) {
  if (locate(g, id)?.zone !== "terrain" || g.spent?.includes(id)) return;
  g.spent = [...(g.spent ?? []), id];
}

export function skipActivation(room: Room, g: GameState) {
  log(g, `${nameOf(room, currentPlayer(g))} passe à la phase de pose.`);
  setPhase(g, "action");
}

export function consumeAction(g: GameState) {
  g.actionsLeft = Math.max(0, g.actionsLeft - 1);
  if (g.actionsLeft === 0) setPhase(g, "end");
}

/** Main vide pendant la phase de pose : on ne peut rien poser, on passe. */
export function passEmptyHand(room: Room, g: GameState) {
  if (g.players[currentPlayer(g)].hand.length) return;
  log(g, `${nameOf(room, currentPlayer(g))} n'a aucune carte en main et passe.`);
  setPhase(g, "end");
}

export function grantExtraAction(room: Room, g: GameState) {
  g.actionsLeft++;
  setPhase(g, "action");
  log(g, `${nameOf(room, currentPlayer(g))} obtient une action supplémentaire (effet de carte).`);
}

export function endTurn(room: Room, g: GameState) {
  const uid = currentPlayer(g);
  const p = g.players[uid];
  rhumeCheck(room, g, uid);
  const need = Math.max(0, g.handSize - p.hand.length);
  const drawn = drawCards(g, uid, need);
  if (drawn) hooks.drew?.(g, uid, drawn);
  log(g, `${nameOf(room, uid)} termine son tour${drawn ? ` et pioche ${drawn} carte${drawn > 1 ? "s" : ""}` : ""}.`);
  st(p).turnsPlayed = (st(p).turnsPlayed ?? 0) + 1;
  expire(room, g, uid, "end");
  hooks.turnEnd?.(room, g, uid);
  // BezRoulette : la condition validée « pour ce tour » est annulée si l'équipe n'a pas gagné entre-temps.
  const t = g.tempVC;
  if (t && t.turnOf === uid) {
    g.tempVC = null;
    const key = teamKey(room, t.uid);
    if (!g.ranking.some((r) => r.team === key) && g.players[t.uid]) {
      log(g, `🎰 BezRoulette : la condition validée pour ce tour ne compte plus.`, { src: "VIC-07" });
      if (t.common) setCommonDone(room, g, key, false);
      else setPersonalDone(room, g, t.uid, false);
    }
  }
  nextTurn(room, g);
  hooks.after?.(room, g);
}

/** Rhume quantique : à la fin du prochain tour de celui qui l'a reçu, s'il l'a encore, il jette sa main et ne pose rien au tour suivant. */
export const RHUME = "FLE-10";
function rhumeCheck(room: Room, g: GameState, uid: string) {
  const r = g.rhume;
  if (!r || r.uid !== uid || pos(g) <= r.at) return;
  delete g.rhume;
  const p = g.players[uid];
  if (!p.terrain.includes(RHUME)) return;
  const n = p.hand.length;
  for (const c of [...p.hand]) moveCard(room, g, c, { uid, zone: "discard" }, true);
  p.cantPlayNext = "Rhume quantique : tu ne peux pas poser de carte ce tour (tu peux seulement défausser).";
  log(g, `🤧 Rhume quantique : ${nameOf(room, uid)} jette sa main (${n} carte${n > 1 ? "s" : ""}) et ne pourra pas poser de carte au prochain tour.`, { src: RHUME, from: uid });
  pushFx(g, { k: "banner", text: `🤧 Rhume quantique : ${nameOf(room, uid)} jette sa main` });
}

/** Passe au joueur suivant encore en jeu (ceux qui ont abandonné sont sautés). */
function nextTurn(room: Room, g: GameState) {
  if (g.order.every((u) => g.players[u].out)) return;
  for (;;) {
    g.turn = (g.turn + 1) % g.order.length;
    if (g.turn === 0) g.round++;
    const p = g.players[currentPlayer(g)];
    if (p.out) continue;
    if (p.skipNext) {
      delete p.skipNext;
      log(g, `⏭ ${nameOf(room, currentPlayer(g))} passe son tour.`);
      pushFx(g, { k: "banner", text: `⏭ ${nameOf(room, currentPlayer(g))} passe son tour` });
      continue;
    }
    break;
  }
  beginTurn(room, g);
}

/** Abandon : le joueur ne joue plus. S'il ne reste qu'une équipe en jeu, elle gagne. */
export function forfeit(room: Room, g: GameState, uid: string, kicked = false) {
  const p = g.players[uid];
  if (!p || p.out) return;
  p.out = true;
  const what = kicked ? "est exclu de la partie par l'hôte" : "abandonne la partie";
  log(g, `${kicked ? "🚫" : "🏳"} ${nameOf(room, uid)} ${what}.`);
  pushFx(g, { k: "banner", text: `${kicked ? "🚫" : "🏳"} ${nameOf(room, uid)} ${what}` });
  if (g.wordClaim?.uid === uid) g.wordClaim = null;
  const alive = [...new Set(g.order.filter((u) => !g.players[u].out).map((u) => teamKey(room, u)))];
  if (alive.length === 1 && !g.ranking.some((r) => r.team === alive[0])) {
    g.ranking.push({ team: alive[0], round: g.round });
    log(g, `🏆 ${teamLabel(room, alive[0])} gagne : les autres ont abandonné.`);
    g.vote = {};
  }
  if (currentPlayer(g) === uid) {
    g.pending = null;
    nextTurn(room, g);
  } else if (g.pending?.prompt.chooser === uid) {
    // Le choix en attente revient au joueur actif pour ne pas bloquer la partie.
    g.pending.prompt = { ...g.pending.prompt, chooser: currentPlayer(g) };
  }
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
  pushFx(g, { k: "shuffle", uid, zone: "deck" });
  log(g, `🔀 La défausse est remélangée pour reformer une pioche.`);
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
  if (dest.zone === "discard" && (at.zone === "hand" || at.zone === "terrain")) {
    const s = st(g.players[at.uid]);
    if (at.zone === "hand") s.handDisc = (s.handDisc ?? 0) + 1;
    else s.terrDisc = (s.terrDisc ?? 0) + 1;
  }
  if (at.zone === "terrain" && dest.zone !== "terrain" && g.spent?.includes(id)) g.spent = g.spent.filter((c) => c !== id);
  if (at.zone === "terrain" && dest.zone !== "terrain") leaveTerrain(room, g, id, at.uid, dest);
  if (at.zone === "hand" && dest.zone !== "hand" && g.revealed?.includes(id)) g.revealed = g.revealed.filter((c) => c !== id);
  const to = g.players[dest.uid][dest.zone];
  let index = dest.index ?? (dest.zone === "deck" ? (dest.bottom ? to.length : 0) : to.length);
  if (dest.zone === "discard" && dest.index === undefined) index = 0; // dessus de la défausse = index 0
  // Un déplacement dans la même zone vers la droite décale l'index après suppression.
  if (at.uid === dest.uid && at.zone === dest.zone && dest.index !== undefined && dest.index > at.index) index--;
  to.splice(Math.max(0, Math.min(index, to.length)), 0, id);
  if (dest.zone === "terrain" && at.zone !== "terrain") g.born = { ...(g.born ?? {}), [id]: pos(g) };
  if (!quiet) {
    const hidden = at.zone === "hand" || at.zone === "deck";
    const label = hidden && dest.zone !== "terrain" && dest.zone !== "discard" ? "une carte" : `« ${card(id).name} »`;
    const where =
      dest.zone === "deck" ? `${dest.bottom ? "au fond de" : "sur"} la pioche` : `${dest.zone === "terrain" ? "sur le" : "dans la"} ${ZONE_LABEL[dest.zone]}`;
    log(g, `${label} : ${ZONE_LABEL[at.zone]} de ${nameOf(room, at.uid)} → ${where} de ${nameOf(room, dest.uid)}.`);
  }
}

/** Une carte quitte les terrains : elle n'est plus désactivée et les cartes placées dessous vont dans la défausse
 * (le Crapaud stratège, lui, suit la carte dans sa nouvelle zone). */
function leaveTerrain(room: Room, g: GameState, id: string, holder: string, dest: Dest) {
  enableCard(g, id);
  if (g.facedown?.includes(id)) g.facedown = g.facedown.filter((c) => c !== id);
  if (g.hot?.includes(id)) g.hot = g.hot.filter((c) => c !== id);
  const under = g.under?.[id];
  if (!under?.length) return;
  const u = { ...g.under };
  delete u[id];
  g.under = u;
  for (const c of under) {
    enableCard(g, c);
    if (g.underFrom?.[c]) delete g.underFrom[c];
    if (c === "GRE-21" || c === "VIC-09") {
      g.players[dest.uid][dest.zone].push(c);
      log(g, `${c === "GRE-21" ? "🐸 Crapaud stratège" : "🪱 Parasite doré"} suit « ${card(id).name} » (${ZONE_LABEL[dest.zone]} de ${nameOf(room, dest.uid)}) et s'en détache.`);
      continue;
    }
    g.players[holder].discard.unshift(c);
    log(g, `« ${card(id).name} » quitte le terrain : « ${card(c).name} » va dans la défausse.`);
  }
}

/** Retire une carte de sa zone et la place sous `host` (elle ne compte plus sur aucun terrain). */
export function attachUnder(g: GameState, id: string, host: string) {
  const at = locate(g, id);
  if (!at) return;
  g.players[at.uid][at.zone].splice(at.index, 1);
  if (g.spent?.includes(id)) g.spent = g.spent.filter((c) => c !== id);
  if (at.zone !== "terrain") enableCard(g, id);
  g.under = { ...(g.under ?? {}), [host]: [...(g.under?.[host] ?? []), id] };
  if (at.zone === "terrain") g.underFrom = { ...(g.underFrom ?? {}), [id]: { uid: at.uid, index: at.index } };
}
/** Sort une carte de sous son hôte et la met dans `dest`. */
export function detachUnder(g: GameState, id: string, dest: Dest) {
  for (const [host, list] of Object.entries(g.under ?? {})) {
    if (!list.includes(id)) continue;
    g.under = { ...g.under, [host]: list.filter((c) => c !== id) };
    if (!g.under[host].length) delete g.under[host];
    const to = g.players[dest.uid][dest.zone];
    to.splice(Math.max(0, Math.min(dest.index ?? to.length, to.length)), 0, id);
    if (g.underFrom?.[id]) delete g.underFrom[id];
    if (dest.zone === "terrain") g.born = { ...(g.born ?? {}), [id]: pos(g) };
    return true;
  }
  return false;
}
/** Carte sous laquelle `id` est placée. */
export const hostOf = (g: GameState, id: string) => Object.entries(g.under ?? {}).find(([, l]) => l.includes(id))?.[0] ?? null;

/** `consume = false` : l'action est décomptée plus tard (mode auto, après les effets de la carte). */
export function playFromHand(room: Room, g: GameState, uid: string, id: string, target: string, index: number, consume = true) {
  moveCard(room, g, id, { uid: target, zone: "terrain", index }, true);
  const where = target === uid ? `en position ${index + 1}` : `sur le terrain de ${nameOf(room, target)}, position ${index + 1}`;
  log(g, `${nameOf(room, uid)} pose « ${card(id).name} » ${where}.`, { dst: id, from: uid, to: target });
  g.lastPlayed = id;
  if (consume && uid === currentPlayer(g) && g.phase === "action") consumeAction(g);
}

export function discardFromHand(room: Room, g: GameState, uid: string, id: string, consume = true) {
  // Une carte défaussée va dans la défausse du joueur chez qui elle se trouve.
  const holder = locate(g, id)?.uid ?? uid;
  moveCard(room, g, id, { uid: holder, zone: "discard" }, true);
  log(g, `${nameOf(room, uid)} défausse « ${card(id).name} » de sa main.`, { dst: id, from: uid });
  g.lastPlayed = null;
  if (consume && uid === currentPlayer(g) && g.phase === "action") consumeAction(g);
}

export function takeRandomFromHand(room: Room, g: GameState, from: string, to: string) {
  const hand = g.players[from].hand;
  if (!hand.length) return;
  const id = hand[Math.floor(RNG.next() * hand.length)];
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
  pushFx(g, { k: "shuffle", uid, zone: "deck" });
  log(g, `🔀 ${nameOf(room, uid)} mélange sa pioche${withDiscard ? " avec sa défausse" : ""}.`);
}

export function shuffleZone(room: Room, g: GameState, uid: string, zone: "deck" | "discard") {
  const p = g.players[uid];
  p[zone] = shuffle(p[zone]);
  pushFx(g, { k: "shuffle", uid, zone });
  log(g, `🔀 ${nameOf(room, uid)} mélange sa ${ZONE_LABEL[zone]}.`);
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
  if (g.players[uid].locked) return log(g, `🔒 ${nameOf(room, uid)} est bloqué : sa sentience ne peut pas changer.`);
  g.players[uid].sentience = v;
  log(g, `${nameOf(room, uid)} : sentience ${v ? "Vraie" : "Fausse"}.`);
}

export function setBlackHole(room: Room, g: GameState, uid: string, b: BlackHole) {
  if (g.players[uid].locked) return log(g, `🔒 ${nameOf(room, uid)} est bloqué : son trou noir ne peut pas changer.`);
  const before = g.players[uid].blackHole;
  g.players[uid].blackHole = b;
  log(g, `${nameOf(room, uid)} : trou noir ${blackHoleLabel(before)} → ${blackHoleLabel(b)}.`);
}

// ---------- Conditions de victoire ----------

export function teamHasWon(room: Room, g: GameState, key: string): boolean {
  if (!g.commonDone.includes(key)) return false;
  return teamMembers(room, key).every((u) => !g.players[u] || g.players[u].out || !g.players[u].personalVC || g.players[u].personalDone);
}

/** Conditions remplies par l'équipe : la commune puis les personnelles. */
function winVCs(g: GameState, members: string[]): string[] {
  const out = g.commonVC ? [g.commonVC] : [];
  for (const u of members) {
    const v = g.players[u]?.personalVC;
    if (v && g.players[u].personalDone && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Résumé de victoire : les dernières lignes du journal qui concernent l'équipe (au plus 6, dans l'ordre). */
function winRecap(room: Room, g: GameState, key: string): string[] {
  const members = teamMembers(room, key);
  const names = members.map((u) => nameOf(room, u));
  const mine = (e: LogEntry) =>
    (e.from && members.includes(e.from)) ||
    (e.to && members.includes(e.to)) ||
    (e.src && members.includes(g.owner[e.src] ?? "")) ||
    names.some((n) => n && e.text.includes(n));
  const out: string[] = [];
  for (let i = g.log.length - 1, seen = 0; i >= 0 && seen < 60 && out.length < 6; i--, seen++) {
    const e = g.log[i];
    if (e.text.startsWith("—") || e.text.startsWith("🎲") || !mine(e)) continue;
    out.unshift(e.text);
  }
  return out;
}

function checkVictory(room: Room, g: GameState, key: string) {
  if (g.ranking.some((r) => r.team === key) || !teamHasWon(room, g, key)) return;
  g.ranking.push({ team: key, round: g.round, recap: winRecap(room, g, key), vcs: winVCs(g, teamMembers(room, key)) });
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
