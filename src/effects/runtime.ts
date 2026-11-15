// Résolution automatique des effets de cartes.
//
// Principe : une action (activer ses cartes, poser une carte, finir son tour) est exécutée d'un bloc.
// Si un effet a besoin d'un choix d'un joueur, l'exécution s'arrête (NeedChoice), l'état revient à
// celui d'avant l'action et la question est enregistrée dans `pending`. Quand le joueur répond,
// l'action est rejouée depuis le début avec les réponses déjà données et les mêmes tirages au hasard.
import { card } from "../data/cards";
import * as E from "../game/engine";
import type { BlackHole, EffectAction, Fx, FxInput, GameState, Prompt, Room } from "../game/types";
import { BLACK_HOLES, blackHoleLabel } from "../game/types";
import { SCRIPTS } from "./scripts";

export type Self = { id: string; me: string };
export type GameEvent =
  | { type: "goldGained"; uid: string; amount: number }
  | { type: "goldLost"; uid: string; amount: number }
  | { type: "sentience"; uid: string; v: boolean }
  | { type: "blackHole"; uid: string; from: BlackHole; to: BlackHole };

type Handlers = { [K in GameEvent["type"]]: (x: Ctx, self: Self, e: Extract<GameEvent, { type: K }>) => void };
export type CardScript = {
  /** Effet activé (pose ou phase d'activation). Renvoie false si l'effet n'a pas pu s'appliquer. */
  activate?: (x: Ctx, self: Self) => boolean | void;
  /** Passifs : réagissent aux événements tant que la carte est sur un terrain. */
  on?: Partial<Handlers>;
};

export const isAutomated = (id: string) => !!SCRIPTS[id];

class NeedChoice extends Error {
  constructor(public prompt: Prompt) {
    super("choix requis");
  }
}

const MAX_DEPTH = 8;
const FX_KEEP = 80;

export class Ctx {
  private ai = 0;
  private ri = 0;
  private depth = 0;

  constructor(public room: Room, public g: GameState, private answers: string[], public rolls: number[]) {}

  // ----- lecture -----
  name = (uid: string) => E.nameOf(this.room, uid);
  p = (uid: string) => this.g.players[uid];
  get order() {
    return this.g.order;
  }
  get current() {
    return E.currentPlayer(this.g);
  }
  others = (uid: string) => this.turnOrder().filter((u) => u !== uid);
  /** Joueurs dans l'ordre du tour en partant du joueur actif. */
  turnOrder() {
    const o = this.g.order;
    return [...o.slice(this.g.turn), ...o.slice(0, this.g.turn)];
  }
  team(uid: string) {
    const k = E.teamKey(this.room, uid);
    return this.turnOrder().filter((u) => E.teamKey(this.room, u) === k);
  }
  allTerrainCards() {
    return this.turnOrder().flatMap((u) => this.p(u).terrain);
  }

  // ----- journal & effets visuels -----
  log(text: string) {
    E.log(this.g, text);
  }
  fx(f: FxInput) {
    this.g.fxSeq = (this.g.fxSeq ?? 0) + 1;
    this.g.fx = [...(this.g.fx ?? []), { ...f, id: this.g.fxSeq } as Fx].slice(-FX_KEEP);
  }
  banner(text: string) {
    this.fx({ k: "banner", text });
  }

  // ----- hasard rejouable -----
  rand(): number {
    if (this.ri >= this.rolls.length) this.rolls.push(Math.random());
    return this.rolls[this.ri++];
  }
  random<T>(arr: T[]): T {
    return arr[Math.floor(this.rand() * arr.length)];
  }
  dice(uid: string, faces: number): number {
    const v = 1 + Math.floor(this.rand() * faces);
    this.fx({ k: "dice", uid, faces, value: v });
    this.log(`🎲 ${this.name(uid)} lance un d${faces} : ${v}.`);
    return v;
  }

  // ----- choix des joueurs -----
  private ask<T>(prompt: Prompt): T {
    if (this.ai < this.answers.length) return JSON.parse(this.answers[this.ai++]) as T;
    throw new NeedChoice(prompt);
  }
  choosePlayer(chooser: string, text: string, options: string[], cardId?: string): string | null {
    if (!options.length) return null;
    if (options.length === 1) return options[0];
    const a = this.ask<string>({ chooser, text, cardId, kind: "player", options });
    return options.includes(a) ? a : options[0];
  }
  chooseOption(chooser: string, text: string, options: string[], cardId?: string): number {
    if (options.length <= 1) return 0;
    const a = this.ask<number>({ chooser, text, cardId, kind: "option", options });
    return Math.max(0, Math.min(options.length - 1, Math.trunc(a)));
  }
  confirm(chooser: string, text: string, cardId?: string) {
    return this.chooseOption(chooser, text, ["Oui", "Non"], cardId) === 0;
  }
  chooseNumber(chooser: string, text: string, min: number, max: number, cardId?: string): number {
    if (max <= min) return min;
    const a = this.ask<number>({ chooser, text, cardId, kind: "number", min, max });
    return Math.max(min, Math.min(max, Math.trunc(Number(a) || 0)));
  }
  chooseCards(chooser: string, text: string, options: string[], min: number, max: number, cardId?: string, blind = false): string[] {
    if (!options.length) return [];
    max = Math.min(max, options.length);
    if (min >= options.length) return options.slice(0, max);
    const a = this.ask<string[]>({ chooser, text, cardId, kind: "cards", options, min, max, blind });
    const picked = [...new Set(a)].filter((id) => options.includes(id)).slice(0, max);
    return picked.length >= min ? picked : options.slice(0, min);
  }
  chooseCard(chooser: string, text: string, options: string[], cardId?: string, blind = false): string | null {
    return this.chooseCards(chooser, text, options, 1, 1, cardId, blind)[0] ?? null;
  }
  chooseOrder(chooser: string, text: string, options: string[], cardId?: string): string[] {
    if (options.length < 2) return options;
    const a = this.ask<string[]>({ chooser, text, cardId, kind: "order", options });
    const ok = a.length === options.length && options.every((id) => a.includes(id));
    return ok ? a : options;
  }
  chooseBlackHole(chooser: string, text: string, exclude?: BlackHole, cardId?: string): BlackHole {
    const opts = BLACK_HOLES.filter((b) => b.id !== exclude);
    return opts[this.chooseOption(chooser, text, opts.map((b) => `${b.icon} ${blackHoleLabel(b.id)}`), cardId)].id;
  }

  // ----- événements & passifs -----
  emit(e: GameEvent) {
    if (this.depth >= MAX_DEPTH) return;
    this.depth++;
    try {
      for (const uid of this.turnOrder()) {
        for (const id of [...this.p(uid).terrain]) {
          const h = SCRIPTS[id]?.on?.[e.type] as ((x: Ctx, s: Self, e: GameEvent) => void) | undefined;
          if (!h || !this.p(uid).terrain.includes(id)) continue;
          h(this, { id, me: uid }, e);
        }
      }
    } finally {
      this.depth--;
    }
  }
  /** À appeler par un passif qui se déclenche, pour l'effet visuel et le journal. */
  triggered(self: Self, what: string) {
    this.fx({ k: "activate", card: self.id, uid: self.me });
    this.log(`⚡ « ${card(self.id).name} » (${this.name(self.me)}) : ${what}`);
  }

  // ----- ressources -----
  gain(uid: string, n: number): number {
    n = Math.trunc(n);
    if (n <= 0) return 0;
    const p = this.p(uid);
    p.gold += n;
    p.goldGainedSince = (p.goldGainedSince ?? 0) + n;
    this.fx({ k: "gold", uid, delta: n });
    this.log(`${this.name(uid)} gagne ${n} gold (${p.gold}).`);
    this.emit({ type: "goldGained", uid, amount: n });
    return n;
  }
  lose(uid: string, n: number): number {
    n = Math.trunc(n);
    const p = this.p(uid);
    const real = p.allowNegativeGold ? n : Math.min(n, Math.max(0, p.gold));
    if (real <= 0) return 0;
    p.gold -= real;
    this.fx({ k: "gold", uid, delta: -real });
    this.log(`${this.name(uid)} perd ${real} gold (${p.gold}).`);
    this.emit({ type: "goldLost", uid, amount: real });
    return real;
  }
  canPay(uid: string, n: number) {
    const p = this.p(uid);
    return p.allowNegativeGold || p.gold >= n;
  }
  /** Dépense : échoue (et ne retire rien) si le joueur n'a pas assez de gold. */
  spend(uid: string, n: number): boolean {
    if (n <= 0) return true;
    if (!this.canPay(uid, n)) {
      this.log(`${this.name(uid)} n'a pas assez de gold (${n} requis).`);
      return false;
    }
    this.lose(uid, n);
    return true;
  }
  transfer(from: string, to: string, n: number): number {
    const real = this.lose(from, n);
    if (real) this.gain(to, real);
    return real;
  }
  setSentience(uid: string, v: boolean) {
    const p = this.p(uid);
    if (p.sentience === v) return;
    p.sentience = v;
    this.fx({ k: "sentience", uid, v });
    this.log(`${this.name(uid)} : sentience ${v ? "Vraie" : "Fausse"}.`);
    this.emit({ type: "sentience", uid, v });
  }
  invertSentience(uid: string) {
    this.setSentience(uid, !this.p(uid).sentience);
  }
  setBlackHole(uid: string, to: BlackHole) {
    const p = this.p(uid);
    const from = p.blackHole;
    if (from === to) return;
    p.blackHole = to;
    this.fx({ k: "bh", uid, to });
    this.log(`${this.name(uid)} : trou noir ${blackHoleLabel(from)} → ${blackHoleLabel(to)}.`);
    this.emit({ type: "blackHole", uid, from, to });
  }
  /** Fait avancer le trou noir d'un cran dans le cycle donné (chaque carte a le sien). */
  cycleBlackHole(uid: string, cycle: BlackHole[]) {
    const i = cycle.indexOf(this.p(uid).blackHole);
    this.setBlackHole(uid, cycle[(i + 1) % cycle.length]);
  }

  // ----- cartes -----
  draw(uid: string, n: number, from = uid): number {
    const k = E.drawCards(this.g, uid, n, from);
    if (k) this.log(`${this.name(uid)} pioche ${k} carte${k > 1 ? "s" : ""}${from !== uid ? ` dans la pioche de ${this.name(from)}` : ""}.`);
    return k;
  }
  move(id: string, dest: E.Dest) {
    E.moveCard(this.room, this.g, id, dest);
    this.fx({ k: "move", card: id });
  }
  /** Envoie une carte dans la défausse de son propriétaire. */
  discard(id: string) {
    const owner = this.g.owner[id] ?? E.locate(this.g, id)?.uid;
    if (owner) this.move(id, { uid: owner, zone: "discard" });
  }
  /** La carte change de propriétaire (volée, récupérée…). */
  take(id: string, uid: string) {
    this.g.owner[id] = uid;
  }
  shuffleDeck(uid: string, withDiscard = false) {
    E.shuffleDeck(this.room, this.g, uid, withDiscard);
  }

  // ----- activation -----
  activateCard(id: string, me: string) {
    const s = SCRIPTS[id];
    const c = card(id);
    if (!s) return;
    if (!s.activate) {
      this.log(`« ${c.name} » n'a pas d'effet à activer (passif).`);
      return;
    }
    this.fx({ k: "activate", card: id, uid: me });
    this.log(`✨ ${this.name(me)} active « ${c.name} ».`);
    if (s.activate(this, { id, me }) === false) {
      this.fx({ k: "fail", card: id, uid: me });
      this.log(`« ${c.name} » : effet impossible.`);
    }
  }

  /** Active les cartes du terrain du joueur actif dans le sens de lecture. S'arrête sur une carte non automatisée. */
  runActivation() {
    const g = this.g;
    while (g.phase === "activation") {
      const id = E.nextActivation(g);
      if (!id) {
        g.phase = "action";
        break;
      }
      if (!SCRIPTS[id]) return; // carte manuelle : le joueur l'applique lui-même
      g.activated = [...(g.activated ?? []), id];
      this.activateCard(id, this.current);
    }
  }
}

function perform(x: Ctx, a: EffectAction) {
  if (a.by !== x.current) throw new Error("Ce n'est pas ton tour.");
  switch (a.t) {
    case "activate":
      x.runActivation();
      break;
    case "play":
      E.playFromHand(x.room, x.g, a.by, a.card, a.target, a.index);
      x.fx({ k: "move", card: a.card });
      x.activateCard(a.card, a.by);
      break;
    case "endTurn":
      E.endTurn(x.room, x.g);
      break;
  }
}

/** Lance une action automatique, ou reprend celle en attente avec la réponse `answer`. */
export function runEffect(room: Room, action: EffectAction | null, answer?: unknown) {
  const g0 = room.game;
  if (!g0) return;
  let answers: string[] = [];
  let rolls: number[] = [];
  let act = action;
  if (answer !== undefined) {
    if (!g0.pending) return;
    answers = [...g0.pending.answers, JSON.stringify(answer)];
    rolls = [...g0.pending.rolls];
    act = g0.pending.action;
  } else if (g0.pending) {
    throw new Error("Un choix est en attente.");
  }
  if (!act) return;
  const base: GameState = { ...structuredClone(g0), pending: null };
  const work = structuredClone(base);
  const x = new Ctx(room, work, answers, rolls);
  const prev = E.RNG.next;
  E.RNG.next = () => x.rand();
  try {
    perform(x, act);
    room.game = work;
  } catch (e) {
    if (!(e instanceof NeedChoice)) throw e;
    base.pending = { action: act, answers, rolls: x.rolls, prompt: e.prompt };
    room.game = base;
  } finally {
    E.RNG.next = prev;
  }
}
