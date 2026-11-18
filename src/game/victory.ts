// Conditions de victoire automatiques : progression (jauge visible par tous) et validation.
// Les interprétations sont notées dans la colonne « Précisions » du tableau.
import { card } from "../data/cards";
import * as E from "./engine";
import type { BlackHole, GameState, PlayerState, Room, Stats } from "./types";

export type Progress = {
  /** avancement de 0 à 1 */
  ratio: number;
  /** texte court affiché sous la jauge */
  text: string;
  done: boolean;
  /** se vérifie seulement à la fin du tour du joueur */
  endOfTurn?: boolean;
  /** validée par un vote (The Word) */
  vote?: boolean;
};

type C = { room: Room; g: GameState; uid: string; p: PlayerState; s: Stats; all: string[]; N: number; pos: number; turnEnd: boolean };

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const frac = (v: number, max: number, label: string): Progress => ({
  ratio: clamp(v / max), text: `${label} ${Math.min(v, max)}/${max}`, done: v >= max,
});
const count = (list: string[], f: (id: string) => boolean) => list.filter(f).length;

/** Premières lettres des cartes du terrain (accents retirés). */
export const lettersOf = (p: PlayerState) =>
  p.terrain.map((id) => card(id).name.trim()[0] ?? "").map((l) => l.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()).filter((l) => /[A-Z]/.test(l));

/** Le mot peut-il s'écrire avec ces lettres (chaque lettre utilisée une fois) ? */
export function wordFits(word: string, letters: string[]) {
  const pool = [...letters];
  const w = word.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]/g, "");
  if (w.length <= 3) return false;
  for (const l of w) {
    const i = pool.indexOf(l);
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return true;
}

/** États de trou noir tenus pendant les tours [from, from + N - 1]. */
function statesInWindow(hist: { pos: number; bh: BlackHole }[], from: number, N: number) {
  const set = new Set<BlackHole>();
  const before = [...hist].reverse().find((h) => h.pos < from);
  if (before) set.add(before.bh);
  for (const h of hist) if (h.pos >= from && h.pos <= from + N - 1) set.add(h.bh);
  if (!before && hist.length && hist[0].pos > from) set.add("Primordial");
  return set;
}

const CHECKS: Record<string, (c: C) => Progress> = {
  // Conquête de l'espace : 3 🌀 et 3 🧠 sur le terrain à la fin de son tour (une carte 🧠🌀 compte des deux côtés)
  "VC-GOB-1": ({ p, g, turnEnd }) => {
    const b = count(p.terrain, (id) => E.tagsOf(g, id).blackHole);
    const s = count(p.terrain, (id) => E.tagsOf(g, id).sentience);
    return {
      ratio: (Math.min(b, 3) + Math.min(s, 3)) / 6, text: `🌀 ${Math.min(b, 3)}/3 · 🧠 ${Math.min(s, 3)}/3 (fin du tour)`,
      done: turnEnd && b >= 3 && s >= 3, endOfTurn: true,
    };
  },
  "VC-GOB-2": ({ s }) => frac(s.spent ?? 0, 250, "Gold dépensés"),
  // Astrophysicienne : 50 gold gagnés entre deux changements de son trou noir pendant son tour
  "VC-GOB-3": ({ s, g, uid }) => {
    if (s.bhGainHit) return { ratio: 1, text: "50 gold gagnés entre deux changements", done: true };
    const mine = E.currentPlayer(g) === uid;
    if (!mine || s.gainSinceBH == null) return { ratio: 0, text: "Change ton trou noir pendant ton tour pour lancer le compteur", done: false };
    return { ...frac(s.gainSinceBH, 50, "Gold depuis le dernier changement :"), done: false };
  },
  // The Word : validé par le vote des autres joueurs
  "VC-EMI-1": ({ p }) => {
    const l = lettersOf(p);
    return { ratio: Math.min(l.length, 4) / 4, text: `Lettres : ${l.join(" ") || "—"}`, done: false, vote: true };
  },
  // Pierre qui roule
  "VC-EMI-2": ({ p, g }) => {
    const moved = (g.movedCards ?? []).some((id) => Object.values(g.players).some((q) => q.terrain.includes(id)));
    const parts = [p.blackHole === "Primordial", !p.sentience, p.gold > 100, moved];
    const n = parts.filter(Boolean).length;
    return {
      ratio: n / 4, done: n === 4,
      text: `${parts[0] ? "✔" : "✖"} Primordial · ${parts[1] ? "✔" : "✖"} sentience fausse · ${parts[2] ? "✔" : "✖"} > 100 gold · ${parts[3] ? "✔" : "✖"} carte déplacée`,
    };
  },
  // Pas le paff : 3 cartes de chaque tag d'autres joueurs touchées
  "VC-EMI-3": ({ s }) => {
    const t = s.cardTags ?? { s: [], g: [], b: [] };
    const v = [t.s.length, t.g.length, t.b.length].map((x) => Math.min(x, 3));
    return { ratio: (v[0] + v[1] + v[2]) / 9, text: `🧠 ${v[0]}/3 · 💰 ${v[1]}/3 · 🌀 ${v[2]}/3`, done: v.every((x) => x >= 3) };
  },
  "VC-POP-1": ({ s }) => frac(s.interOthers ?? 0, 66, "Interactions avec d'autres joueurs :"),
  "VC-POP-2": ({ g, all }) => frac(count(all, (u) => g.players[u].blackHole === "Blazard"), all.length, "Joueurs en Blazard :"),
  "VC-POP-3": ({ s }) => frac(s.goldMoved ?? 0, 500, "Gold échangés entre joueurs :"),
  "VC-MET-1": ({ s, g, uid }) => {
    const v = E.currentPlayer(g) === uid ? s.bhTurn ?? 0 : 0;
    return frac(v, 4, "Changements de trou noir ce tour :");
  },
  "VC-MET-2": ({ p }) => {
    const w = p.blackHole === "Trou de ver";
    return {
      ratio: (Math.min(p.gold, 250) / 250 + (w ? 1 : 0)) / 2, done: w && p.gold >= 250,
      text: `💰 ${Math.min(p.gold, 250)}/250 · ${w ? "✔" : "✖"} Trou de ver`,
    };
  },
  // Cent Temps : 20 de ses tours, −1 par tranche de 50 gold possédés
  "VC-MET-3": ({ s, p }) => {
    const need = Math.max(0, 20 - Math.floor(Math.max(0, p.gold) / 50));
    const v = s.turnsPlayed ?? 0;
    return { ratio: need ? clamp(v / need) : 1, text: `Tours joués ${v}/${need} (−1 par 50 gold)`, done: v >= need };
  },
  // Marchandise amphibienne : dépenser 50 gold et en gagner 50 pendant un même tour
  "VC-GRE-1": ({ s, p, g, uid }) => {
    const mine = E.currentPlayer(g) === uid;
    const sp = mine ? s.spentTurn ?? 0 : 0;
    const ga = mine ? p.goldGainedSince ?? 0 : 0;
    return {
      ratio: (Math.min(sp, 50) + Math.min(ga, 50)) / 100, done: sp >= 50 && ga >= 50,
      text: mine ? `Ce tour : dépensés ${Math.min(sp, 50)}/50 · gagnés ${Math.min(ga, 50)}/50` : "Se joue pendant ton tour",
    };
  },
  // Frog TV : sentience fausse et gold impairs à la fin de son tour
  "VC-GRE-2": ({ p, turnEnd }) => {
    const a = !p.sentience;
    const b = Math.abs(p.gold) % 2 === 1;
    return {
      ratio: ((a ? 1 : 0) + (b ? 1 : 0)) / 2, endOfTurn: true, done: turnEnd && a && b,
      text: `${a ? "✔" : "✖"} sentience fausse · ${b ? "✔" : "✖"} gold impairs (fin du tour)`,
    };
  },
  "VC-POL-1": ({ s }) => frac(s.discOthers ?? 0, 5, "Cartes adverses défaussées :"),
  // Coup d'état : un autre joueur n'a plus aucune carte sur son terrain (pas pendant le premier tour de table)
  "VC-POL-2": ({ g, all, uid, room }) => {
    if (g.round < 2) return { ratio: 0, text: "Possible à partir du 2e tour de table", done: false };
    const empty = all.filter((u) => u !== uid && !g.players[u].out && !g.players[u].terrain.length);
    return {
      ratio: empty.length ? 1 : 0, done: empty.length > 0,
      text: empty.length ? `Terrain vide : ${empty.map((u) => E.nameOf(room, u)).join(", ")}` : "Aucun autre terrain n'est vide",
    };
  },
  "VC-FLE-1": ({ s }) => frac(s.lost ?? 0, 200, "Gold perdus :"),
  "VC-FLE-2": ({ s }) => frac(s.offTurn ?? 0, 5, "Activations pendant le tour d'un autre :"),
  "VC-FLE-3": ({ s }) => frac(s.failed ?? 0, 5, "Activations ratées en phase 1 :"),
  // Transcendance : seul joueur sentient à la fin de son tour
  "VC-BASE-1": ({ g, all, uid, p, turnEnd }) => {
    const others = count(all, (u) => u !== uid && g.players[u].sentience);
    const ok = p.sentience && others === 0;
    return {
      ratio: ok ? 1 : p.sentience ? 0.5 : 0, endOfTurn: true, done: turnEnd && ok,
      text: `${p.sentience ? "✔" : "✖"} sentient · ${others} autre(s) sentient(s) (fin du tour)`,
    };
  },
  // Capitaliste : strictement le plus riche pendant un tour de table complet
  "VC-BASE-2": ({ s, pos, N }) => {
    if (s.richSince == null) return { ratio: 0, text: "Pas (strictement) le plus riche", done: false };
    const v = pos - s.richSince;
    return { ratio: clamp(v / N), text: `Le plus riche depuis ${v}/${N} tour(s)`, done: v >= N };
  },
  // Hole in one : les 4 trous noirs pendant un tour de table
  "VC-BASE-3": ({ s, pos, N }) => {
    const hist = s.bhHist ?? [];
    let best = 0;
    for (let from = Math.max(0, pos - 60); from <= pos; from++) {
      const n = statesInWindow(hist, from, N).size;
      if (n >= 4) return { ratio: 1, text: "4 trous noirs en un tour de table", done: true };
      if (from >= pos - N + 1) best = Math.max(best, n);
    }
    return { ratio: best / 4, text: `Trous noirs différents sur le dernier tour de table : ${best}/4`, done: false };
  },
  "VC-BASE-4": ({ s, all, uid }) => {
    const others = all.filter((u) => u !== uid);
    const v = count(others, (u) => (s.met ?? []).includes(u));
    return frac(v, others.length, "Joueurs avec qui tu as interagi :");
  },
};

/** Avancement d'une condition pour un joueur. */
export function vcProgress(room: Room, g: GameState, vc: string, uid: string, turnEnd = false): Progress | null {
  const f = CHECKS[vc];
  const p = g.players[uid];
  if (!f || !p) return null;
  return f({ room, g, uid, p, s: p.stats ?? {}, all: g.order, N: g.order.length, pos: E.pos(g), turnEnd });
}

export const isAutoVC = (vc: string) => !!CHECKS[vc];

/** Meilleur avancement d'une équipe pour la condition commune. */
export function teamProgress(room: Room, g: GameState, team: string): { uid: string; prog: Progress } | null {
  let best: { uid: string; prog: Progress } | null = null;
  for (const u of E.teamMembers(room, team)) {
    const prog = vcProgress(room, g, g.commonVC, u);
    if (prog && (!best || prog.ratio > best.prog.ratio)) best = { uid: u, prog };
  }
  return best;
}

/** Suit la série « strictement le plus riche » de chaque joueur. */
function trackRichest(g: GameState) {
  const p = E.pos(g);
  for (const u of g.order) {
    const me = g.players[u].gold;
    const richest = g.order.every((o) => o === u || g.players[o].gold < me);
    const s = g.players[u].stats ?? (g.players[u].stats = {});
    if (!richest) s.richSince = null;
    else if (s.richSince == null) s.richSince = p;
  }
}

function announce(room: Room, g: GameState, uid: string, vc: string, personal: boolean) {
  E.pushFx(g, { k: "vcDone", uid, card: vc, team: E.teamKey(room, uid) });
  if (personal) victoriousDefeat(room, g, uid, vc);
}

/** Défaite victorieuse : ceux qui l'ont sur leur terrain prennent la condition que `uid` vient de remplir. */
function victoriousDefeat(room: Room, g: GameState, uid: string, vc: string) {
  for (const w of g.order) {
    const p = g.players[w];
    if (w === uid || p.out || p.personalDone || !p.terrain.includes("FLE-32") || p.personalVC === vc) continue;
    p.personalVC = vc;
    E.log(g, `⚡ « Défaite victorieuse » : ${E.nameOf(room, w)} prend la condition « ${card(vc).name} » de ${E.nameOf(room, uid)}.`, { src: "FLE-32", dst: vc, from: w, to: uid });
  }
}

/** Coche automatiquement les conditions remplies. `turnEndUid` : joueur dont le tour se termine. */
export function checkVictories(room: Room, g: GameState, turnEndUid?: string) {
  if (!g.order.length) return;
  trackRichest(g);
  for (const u of g.order) {
    const p = g.players[u];
    if (!p.personalVC || p.personalDone || p.out) continue;
    const prog = vcProgress(room, g, p.personalVC, u, u === turnEndUid);
    if (prog?.done) {
      announce(room, g, u, p.personalVC, true);
      E.setPersonalDone(room, g, u, true);
    }
  }
  for (const team of [...new Set(g.order.map((u) => E.teamKey(room, u)))]) {
    if (g.commonDone.includes(team)) continue;
    const who = E.teamMembers(room, team).filter((u) => !g.players[u]?.out).find((u) => vcProgress(room, g, g.commonVC, u, u === turnEndUid)?.done);
    if (who) {
      announce(room, g, who, g.commonVC, false);
      E.setCommonDone(room, g, team, true);
    }
  }
}

// ----- The Word : proposition puis vote -----

export function claimWord(room: Room, g: GameState, uid: string, word: string) {
  const letters = lettersOf(g.players[uid]);
  if (!wordFits(word, letters)) throw new Error("Ce mot ne s'écrit pas avec tes lettres (plus de 3 lettres, chaque lettre une fois).");
  g.wordClaim = { uid, word: word.trim().toUpperCase(), votes: {} };
  E.log(g, `🔤 ${E.nameOf(room, uid)} propose le mot « ${word.trim().toUpperCase()} » pour « The Word ». Les autres joueurs votent.`);
  resolveWord(room, g);
}

export function voteWord(room: Room, g: GameState, voter: string, ok: boolean) {
  if (!g.wordClaim || voter === g.wordClaim.uid) return;
  g.wordClaim.votes[voter] = ok;
  resolveWord(room, g);
}

function resolveWord(room: Room, g: GameState) {
  const c = g.wordClaim;
  if (!c) return;
  const voters = g.order.filter((u) => u !== c.uid);
  const yes = voters.filter((u) => c.votes[u] === true).length;
  const no = voters.filter((u) => c.votes[u] === false).length;
  if (yes * 2 > voters.length || !voters.length) {
    g.wordClaim = null;
    E.log(g, `🔤 Mot « ${c.word} » accepté.`);
    const p = g.players[c.uid];
    if (p.personalVC === "VC-EMI-1" && !p.personalDone) {
      announce(room, g, c.uid, "VC-EMI-1", true);
      E.setPersonalDone(room, g, c.uid, true);
    } else if (g.commonVC === "VC-EMI-1" && !g.commonDone.includes(E.teamKey(room, c.uid))) {
      announce(room, g, c.uid, "VC-EMI-1", false);
      E.setCommonDone(room, g, E.teamKey(room, c.uid), true);
    }
  } else if (no * 2 >= voters.length) {
    g.wordClaim = null;
    E.log(g, `🔤 Mot « ${c.word} » refusé.`);
  }
}

E.hooks.after = (room, g) => checkVictories(room, g);
E.hooks.vcOk = isAutoVC;
E.hooks.turnEnd = (room, g, uid) => checkVictories(room, g, uid);
