// Résolution automatique des effets de cartes.
//
// Principe : une action (activer ses cartes, poser une carte, finir son tour) est exécutée d'un bloc.
// Si un effet a besoin d'un choix d'un joueur, l'exécution s'arrête (NeedChoice), l'état revient à
// celui d'avant l'action et la question est enregistrée dans `pending`. Quand le joueur répond,
// l'action est rejouée depuis le début avec les réponses déjà données et les mêmes tirages au hasard.
import { DEFAULT_REASON, REASONS } from "./reasons";
import { card } from "../data/cards";
import * as E from "../game/engine";
import type { BlackHole, EffectAction, FxInput, GameState, Prompt, Room } from "../game/types";
import { BLACK_HOLES, blackHoleLabel, showWeather } from "../game/types";
import { SCRIPTS } from "./scripts";
import "../game/victory";

export type Self = { id: string; me: string };
export type GameEvent =
  | { type: "goldGained"; uid: string; amount: number }
  | { type: "goldLost"; uid: string; amount: number }
  | { type: "sentience"; uid: string; v: boolean }
  | { type: "blackHole"; uid: string; from: BlackHole; to: BlackHole }
  /** un effet lancé par `actor` touche quelque chose de `target` (gold, sentience, trou noir, cartes…) */
  | { type: "interaction"; actor: string; target: string; what: string }
  /** `uid` pioche `n` cartes (src = carte qui l'a fait piocher, null = pioche du tour) */
  | { type: "draw"; uid: string; n: number; from: string; src: string | null }
  /** `uid` défausse `card` de sa main (action du tour ou effet) */
  | { type: "discard"; uid: string; card: string; src: string | null }
  /** un joueur tombe à 0 gold */
  | { type: "zeroGold"; uid: string }
  /** `card` est posée sur le terrain de `uid` (depuis la main, la pioche ou la défausse) */
  | { type: "placed"; uid: string; card: string; src: string | null }
  /** l'effet de `src` défausse `card` du terrain de `uid` */
  | { type: "terrainDiscard"; uid: string; card: string; src: string }
  /** `thief` prend une carte de `victim` sans rien donner en retour */
  | { type: "steal"; thief: string; victim: string; card: string };

type Handlers = { [K in GameEvent["type"]]: (x: Ctx, self: Self, e: Extract<GameEvent, { type: K }>) => void };
export type CardScript = {
  /** Effet activé (pose ou phase d'activation). Renvoie false si l'effet n'a pas pu s'appliquer. */
  activate?: (x: Ctx, self: Self) => boolean | void;
  /** Passifs : réagissent aux événements tant que la carte est sur un terrain. */
  on?: Partial<Handlers>;
  /** ne peut pas être défaussée par un effet */
  fixed?: boolean;
  /** ne peut pas être posée depuis la main (raison affichée) */
  noPlay?: string;
  /** ne peut arriver sur un terrain que par l'effet de cette carte */
  placedOnlyBy?: string;
};

export const isAutomated = (id: string) => !!SCRIPTS[id];

class NeedChoice extends Error {
  constructor(public prompt: Prompt) {
    super("choix requis");
  }
}

const MAX_DEPTH = 8;

export class Ctx {
  private ai = 0;
  private ri = 0;
  private depth = 0;
  /** joueur dont l'effet est en train de s'appliquer */
  actor: string | null = null;
  /** carte dont l'effet est en train de s'appliquer */
  source: string | null = null;
  private muteInteractions = 0;
  /** > 0 pendant un échange : les cartes déplacées ne comptent pas comme volées */
  private exchanging = 0;
  /** pourquoi l'effet en cours a échoué (gold manquant, aucune cible, paiement refusé) */
  reason: string | null = null;

  /** Mode aperçu : les questions reçoivent une réponse par défaut et sont mémorisées. */
  public preview: Prompt[] | null = null;

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
  log(text: string, extra?: { src?: string; dst?: string; from?: string; to?: string }) {
    E.log(this.g, text, { src: this.source ?? undefined, from: this.actor ?? undefined, ...extra });
  }
  fx(f: FxInput) {
    if (f.k === "move") return; // les déplacements sont animés directement par la table
    E.pushFx(this.g, f);
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

  /** Dé trou noir (4 faces : Primordial, Quasar, Blazard, Trou de ver). */
  bhDice(uid: string): BlackHole {
    const v = 1 + Math.floor(this.rand() * 4);
    const b = BLACK_HOLES[v - 1].id;
    this.fx({ k: "dice", uid, faces: 4, value: v, bh: true });
    this.log(`🎲 ${this.name(uid)} lance le dé trou noir : ${b}.`);
    return b;
  }

  // ----- choix des joueurs -----
  private ask<T>(prompt: Prompt): T {
    if (!prompt.cardId && this.source) prompt = { ...prompt, cardId: this.source };
    if (this.ai < this.answers.length) return JSON.parse(this.answers[this.ai++]) as T;
    if (this.preview) {
      this.preview.push(prompt);
      return defaultAnswer(prompt) as T;
    }
    throw new NeedChoice(prompt);
  }
  choosePlayer(chooser: string, text: string, options: string[], cardId?: string): string | null {
    if (!options.length) {
      this.reason = "Aucune cible possible.";
      return null;
    }
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
    const ok = this.chooseOption(chooser, text, ["Oui", "Non"], cardId) === 0;
    if (!ok) this.reason = `${this.name(chooser)} a refusé.`;
    return ok;
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
  /** Place (0 = première position) où poser `id` sur le terrain de `uid`. */
  chooseSlot(chooser: string, text: string, uid: string, id: string, cardId?: string): number {
    const n = this.p(uid).terrain.length;
    if (n === 0) return 0;
    const a = this.ask<number>({ chooser, text, cardId, kind: "slot", uid, card: id });
    return Math.max(0, Math.min(n, Math.trunc(Number(a) || 0)));
  }
  chooseBlackHole(chooser: string, text: string, exclude?: BlackHole, cardId?: string): BlackHole {
    const opts = BLACK_HOLES.filter((b) => b.id !== exclude);
    return opts[this.chooseOption(chooser, text, opts.map((b) => `${showWeather() ? `${b.icon} ` : ""}${blackHoleLabel(b.id)}`), cardId)].id;
  }

  // ----- événements & passifs -----
  emit(e: GameEvent) {
    if (this.depth >= MAX_DEPTH) return;
    this.depth++;
    try {
      for (const [uid, id, zone] of this.passiveCards()) {
        {
          const h = SCRIPTS[id]?.on?.[e.type] as ((x: Ctx, s: Self, e: GameEvent) => void) | undefined;
          if (!h) continue;
          // La carte a pu bouger entre-temps (défaussée par un autre passif…).
          const still = zone === "discard" ? E.locate(this.g, id)?.zone === "discard" : this.p(uid)[zone].includes(id);
          if (!still) continue;
          const prevActor = this.actor;
          const prevSource = this.source;
          this.actor = uid;
          this.source = id;
          if (e.type === "interaction") this.muteInteractions++;
          try {
            h(this, { id, me: uid }, e);
          } finally {
            this.actor = prevActor;
            this.source = prevSource;
            if (e.type === "interaction") this.muteInteractions--;
          }
        }
      }
    } finally {
      this.depth--;
    }
  }
  /**
   * Cartes dont les passifs écoutent : les terrains, plus la main d'un joueur à 0 gold avec « Fléaux parallèles »
   * et le dessus de la défausse d'un joueur avec « Singularité radioactive » (possesseur = joueur actif).
   */
  passiveCards(): [string, string, "terrain" | "hand" | "discard"][] {
    const out: [string, string, "terrain" | "hand" | "discard"][] = [];
    for (const uid of this.turnOrder()) {
      const p = this.p(uid);
      for (const id of p.terrain) out.push([uid, id, "terrain"]);
      if (p.terrain.includes("FLE-11") && p.gold <= 0) for (const id of p.hand) out.push([uid, id, "hand"]);
      if (p.terrain.includes("FLE-14") && p.discard[0] && SCRIPTS[p.discard[0]]?.on) out.push([this.current, p.discard[0], "discard"]);
    }
    return out;
  }
  /** Un effet touche quelque chose de `target` : compte l'interaction et prévient les passifs. */
  interact(target: string, what: string) {
    const actor = this.actor;
    if (!actor || this.muteInteractions > 0 || !this.p(actor)) return;
    const s = E.st(this.p(actor));
    s.interactions = (s.interactions ?? 0) + 1;
    if (target !== actor && this.p(target)) {
      s.interOthers = (s.interOthers ?? 0) + 1;
      if (!(s.met ?? []).includes(target)) s.met = [...(s.met ?? []), target];
    }
    this.emit({ type: "interaction", actor, target, what });
  }
  /** Gold passés d'un joueur à un autre à cause de l'acteur. */
  moved(n: number) {
    const actor = this.actor;
    if (!actor || n <= 0 || !this.p(actor)) return;
    const s = E.st(this.p(actor));
    s.goldMoved = (s.goldMoved ?? 0) + n;
  }

  // ----- outils de calcul -----
  /** 10 % (ou autre pourcentage) arrondi à l'inférieur. */
  pct(n: number, percent = 10) {
    return Math.floor((Math.max(0, n) * percent) / 100);
  }
  /** Le plus riche parmi `list` (égalité : tirage au hasard). */
  richest(list: string[]): string | null {
    if (!list.length) return null;
    const max = Math.max(...list.map((u) => this.p(u).gold));
    return this.random(list.filter((u) => this.p(u).gold === max));
  }
  poorest(list: string[]): string | null {
    if (!list.length) return null;
    const min = Math.min(...list.map((u) => this.p(u).gold));
    return this.random(list.filter((u) => this.p(u).gold === min));
  }
  /** La carte a-t-elle un effet automatique à activer ? */
  canActivate = (id: string) => !!SCRIPTS[id]?.activate;
  isBlazard = (u: string) => this.p(u).blackHole === "Blazard";

  /** À appeler par un passif qui se déclenche, pour l'effet visuel et le journal. */
  triggered(self: Self, what: string) {
    this.countOffTurn(self.id, self.me);
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
    const s = E.st(p);
    if (uid === this.current && s.gainSinceBH != null) s.gainSinceBH += n;
    this.fx({ k: "gold", uid, delta: n });
    this.log(`${this.name(uid)} gagne ${n} gold (${p.gold}).`, { to: uid });
    this.interact(uid, "gold");
    this.emit({ type: "goldGained", uid, amount: n });
    return n;
  }
  lose(uid: string, n: number): number {
    n = Math.trunc(n);
    const p = this.p(uid);
    const real = p.allowNegativeGold ? n : Math.min(n, Math.max(0, p.gold));
    if (real <= 0) return 0;
    p.gold -= real;
    E.st(p).lost = (E.st(p).lost ?? 0) + real;
    this.fx({ k: "gold", uid, delta: -real });
    this.log(`${this.name(uid)} perd ${real} gold (${p.gold}).`, { to: uid });
    this.interact(uid, "gold");
    this.emit({ type: "goldLost", uid, amount: real });
    if (p.gold === 0) this.emit({ type: "zeroGold", uid });
    return real;
  }
  canPay(uid: string, n: number) {
    const p = this.p(uid);
    const ok = p.allowNegativeGold || p.gold >= n;
    if (!ok) this.reason = `Pas assez de gold : ${n} requis, ${this.name(uid)} en a ${p.gold}.`;
    return ok;
  }
  /** Dépense : échoue (et ne retire rien) si le joueur n'a pas assez de gold. */
  spend(uid: string, n: number): boolean {
    if (n <= 0) return true;
    if (!this.canPay(uid, n)) {
      this.log(`${this.name(uid)} n'a pas assez de gold (${n} requis).`);
      return false;
    }
    this.lose(uid, n);
    const s = E.st(this.p(uid));
    s.spent = (s.spent ?? 0) + n;
    return true;
  }
  transfer(from: string, to: string, n: number): number {
    const real = this.lose(from, n);
    if (real) this.gain(to, real);
    if (from !== to) this.moved(real);
    return real;
  }
  /** Échange les gold de deux joueurs. */
  swapGold(a: string, b: string) {
    const ga = this.p(a).gold;
    const gb = this.p(b).gold;
    if (ga === gb) return;
    this.p(a).gold = gb;
    this.p(b).gold = ga;
    const loser = this.p(ga > gb ? a : b);
    E.st(loser).lost = (E.st(loser).lost ?? 0) + Math.abs(ga - gb);
    this.fx({ k: "gold", uid: a, delta: gb - ga });
    this.fx({ k: "gold", uid: b, delta: ga - gb });
    this.log(`${this.name(a)} et ${this.name(b)} échangent leurs gold (${gb} / ${ga}).`);
    this.moved(Math.abs(ga - gb));
    this.interact(a, "gold");
    this.interact(b, "gold");
    if (gb > ga) this.emit({ type: "goldGained", uid: a, amount: gb - ga });
    else this.emit({ type: "goldLost", uid: a, amount: ga - gb });
    if (ga > gb) this.emit({ type: "goldGained", uid: b, amount: ga - gb });
    else this.emit({ type: "goldLost", uid: b, amount: gb - ga });
  }
  setSentience(uid: string, v: boolean) {
    const p = this.p(uid);
    if (p.sentience === v) return;
    if (p.locked) return this.log(`🔒 ${this.name(uid)} est bloqué : sa sentience ne change pas.`);
    p.sentience = v;
    this.interact(uid, "sentience");
    this.fx({ k: "sentience", uid, v });
    this.log(`${this.name(uid)} : sentience ${v ? "Vraie" : "Fausse"}.`, { to: uid });
    this.emit({ type: "sentience", uid, v });
  }
  invertSentience(uid: string) {
    this.setSentience(uid, !this.p(uid).sentience);
  }
  setBlackHole(uid: string, to: BlackHole) {
    const p = this.p(uid);
    const from = p.blackHole;
    if (from === to) return;
    if (p.locked) return this.log(`🔒 ${this.name(uid)} est bloqué : son trou noir ne change pas.`);
    p.blackHole = to;
    this.trackBlackHole(uid, to);
    this.interact(uid, "trou noir");
    this.fx({ k: "bh", uid, to });
    this.log(`${this.name(uid)} : trou noir ${blackHoleLabel(from)} → ${blackHoleLabel(to)}.`, { to: uid });
    this.emit({ type: "blackHole", uid, from, to });
  }
  private trackBlackHole(uid: string, to: BlackHole) {
    const s = E.st(this.p(uid));
    s.bhHist = [...(s.bhHist ?? []), { pos: E.pos(this.g), bh: to }].slice(-40);
    if (uid !== this.current) return;
    s.bhTurn = (s.bhTurn ?? 0) + 1;
    if (s.gainSinceBH != null && s.gainSinceBH >= 50) s.bhGainHit = true;
    s.gainSinceBH = 0;
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
    if (k) this.interact(from, "pioche");
    if (k) this.emit({ type: "draw", uid, n: k, from, src: this.source });
    return k;
  }
  move(id: string, dest: E.Dest): boolean {
    const at = E.locate(this.g, id);
    const src = this.source;
    if (at?.zone === "terrain" && dest.zone === "discard" && SCRIPTS[id]?.fixed && src !== id) {
      this.log(`🛡 « ${card(id).name} » ne peut pas être défaussée.`, { dst: id });
      return false;
    }
    const only = SCRIPTS[id]?.placedOnlyBy;
    if (only && dest.zone === "terrain" && at?.zone !== "terrain" && src !== only) {
      this.log(`🚫 « ${card(id).name} » ne peut être posée que par « ${card(only).name} ».`, { dst: id });
      return false;
    }
    E.moveCard(this.room, this.g, id, dest, !!(src && src !== id && at));
    if (src && src !== id && at) this.linkMove(src, id, at.uid, dest);
    if (dest.zone === "terrain" && !(this.g.movedCards ?? []).includes(id)) this.g.movedCards = [...(this.g.movedCards ?? []), id];
    this.touchCard(id, dest.zone === "terrain" ? dest.uid : null);
    if (at) this.interact(at.uid, at.zone);
    this.fx({ k: "move", card: id });
    const now = E.locate(this.g, id);
    const actor = this.actor;
    if (at && now && actor && !this.exchanging && at.uid !== actor && now.uid === actor && this.p(at.uid))
      this.emit({ type: "steal", thief: actor, victim: at.uid, card: id });
    if (at?.zone === "terrain" && now?.zone !== "terrain" && src && src !== id && dest.zone === "discard")
      this.emit({ type: "terrainDiscard", uid: at.uid, card: id, src });
    if (now?.zone === "terrain" && at && at.zone !== "terrain") this.emit({ type: "placed", uid: now.uid, card: id, src });
    return true;
  }
  /** Défausse une carte : elle va dans la défausse du joueur chez qui elle se trouve (terrain, main…). */
  discard(id: string) {
    const at = E.locate(this.g, id);
    if (at) this.move(id, { uid: at.uid, zone: "discard" });
  }
  /** Échange deux cartes : chacune prend exactement la place (joueur, zone, position) de l'autre. */
  swap(a: string, b: string) {
    const pa = E.locate(this.g, a);
    const pb = E.locate(this.g, b);
    if (!pa || !pb || a === b) return;
    this.p(pa.uid)[pa.zone][pa.index] = b;
    this.p(pb.uid)[pb.zone][pb.index] = a;
    for (const [id, at, to] of [[a, pa, pb], [b, pb, pa]] as const) {
      if (to.zone === "terrain" && at.zone !== "terrain") this.g.born = { ...(this.g.born ?? {}), [id]: E.pos(this.g) };
      this.touchCard(id, to.zone === "terrain" ? to.uid : null);
      this.fx({ k: "move", card: id });
      if (this.source) this.fx({ k: "link", from: this.source, to: id, toUid: to.uid, text: `échange « ${card(id).name} »` });
    }
    this.exchanging++;
    try {
      this.interact(pa.uid, pa.zone);
      if (pb.uid !== pa.uid) this.interact(pb.uid, pb.zone);
    } finally {
      this.exchanging--;
    }
    this.log(`🔁 « ${card(a).name} » et « ${card(b).name} » échangent leurs places.`, { dst: b, to: pb.uid });
  }
  /** Déplace sans compter de vol (échanges en plusieurs morceaux). */
  moveExchange(id: string, dest: E.Dest) {
    this.exchanging++;
    try {
      return this.move(id, dest);
    } finally {
      this.exchanging--;
    }
  }
  /** La carte change de propriétaire (volée, récupérée…). */
  take(id: string, uid: string) {
    this.g.owner[id] = uid;
  }
  /** Mélange une seule zone d'un joueur (pioche ou défausse, sans les réunir). */
  shuffleZone(uid: string, zone: "deck" | "discard") {
    E.shuffleZone(this.room, this.g, uid, zone);
    this.interact(uid, zone === "deck" ? "pioche" : "défausse");
  }
  shuffleDeck(uid: string, withDiscard = false) {
    E.shuffleDeck(this.room, this.g, uid, withDiscard);
    this.interact(uid, "pioche");
  }
  /** Fait tourner les mains : chaque joueur de `list` reçoit la main du précédent (2 joueurs = échange). */
  rotateHands(list: string[]) {
    if (list.length < 2) return;
    const hands = list.map((u) => this.p(u).hand);
    list.forEach((u, i) => (this.p(u).hand = hands[(i - 1 + list.length) % list.length]));
    this.log(list.length === 2
      ? `${this.name(list[0])} et ${this.name(list[1])} échangent leurs mains.`
      : `Les mains tournent : ${list.map((u) => this.name(u)).join(" → ")}.`);
    for (const u of list) this.interact(u, "main");
  }
  /** Une carte en déplace une autre : flèche sur la table et résumé dans le journal. */
  private linkMove(src: string, id: string, fromUid: string, dest: E.Dest) {
    const now = E.locate(this.g, id);
    const where = now?.uid ?? dest.uid;
    const verb: Record<string, string> = {
      discard: "défausse", deck: dest.bottom ? "met au fond de la pioche" : "remet dans la pioche", hand: "met dans la main", terrain: "déplace sur le terrain",
    };
    const v = verb[now?.zone ?? dest.zone] ?? "déplace";
    const label = `${card(id).name}`;
    const owner = fromUid === where ? this.name(where) : `${this.name(fromUid)} → ${this.name(where)}`;
    this.fx({ k: "link", from: src, to: id, toUid: where, text: `${v} « ${label} »` });
    this.log(`🔗 « ${card(src).name} » ${v} « ${label} » (${owner}).`, { dst: id, to: where });
  }

  /** L'acteur touche une carte d'un autre joueur (ou envoie une des siennes chez un autre) : condition « Pas le paff ». */
  touchCard(id: string, toTerrainOf: string | null) {
    const actor = this.actor;
    if (!actor) return;
    const owner = this.g.owner[id];
    if (!(owner && owner !== actor) && !(toTerrainOf && toTerrainOf !== actor)) return;
    const s = E.st(this.p(actor));
    const t = s.cardTags ?? { s: [], g: [], b: [] };
    if ([...t.s, ...t.g, ...t.b].includes(id)) return;
    const tg = card(id).tags;
    const opts = (["s", "g", "b"] as const).filter((k) => (k === "s" ? tg.sentience : k === "g" ? tg.gold : tg.blackHole));
    if (!opts.length) return;
    // Une carte à plusieurs tags compte pour le tag le moins rempli.
    const k = opts.reduce((a, b) => (t[b].length < t[a].length ? b : a));
    s.cardTags = { ...t, [k]: [...t[k], id] };
  }
  /** Bloque la sentience et le trou noir du joueur jusqu'au début de son prochain tour. */
  lock(uid: string) {
    this.p(uid).locked = true;
    this.log(`🔒 ${this.name(uid)} est bloqué jusqu'à son prochain tour (sentience et trou noir figés).`);
    this.interact(uid, "blocage");
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
    this.countOffTurn(id, me);
    if (this.source && this.source !== id) {
      this.fx({ k: "link", from: this.source, to: id, toUid: me, text: `réactive « ${c.name} »` });
      this.log(`🔗 « ${card(this.source).name} » réactive « ${c.name} ».`, { dst: id, to: me });
    }
    this.fx({ k: "activate", card: id, uid: me });
    const prevActor = this.actor;
    const prevSource = this.source;
    this.actor = me;
    this.source = id;
    this.log(`✨ ${this.name(me)} active « ${c.name} ».`);
    this.reason = null;
    try {
      if (s.activate(this, { id, me }) === false) {
        const why = this.reason ?? REASONS[id] ?? DEFAULT_REASON;
        this.fx({ k: "fail", card: id, uid: me, reason: why });
        if (me === this.current && this.g.phase === "activation") E.st(this.p(me)).failed = (E.st(this.p(me)).failed ?? 0) + 1;
        this.log(`« ${c.name} » : effet impossible. ${why}`);
      }
    } finally {
      this.actor = prevActor;
      this.source = prevSource;
      E.markSpent(this.g, id);
    }
  }

  /** Une carte de `owner` qui s'active pendant le tour d'un autre (condition « Symbiote »). */
  private countOffTurn(id: string, me: string) {
    const owner = this.g.owner[id] ?? me;
    if (owner === this.current || !this.p(owner)) return;
    E.st(this.p(owner)).offTurn = (E.st(this.p(owner)).offTurn ?? 0) + 1;
  }

  /** Active les cartes du terrain du joueur actif dans le sens de lecture. S'arrête sur une carte non automatisée. */
  runActivation() {
    const g = this.g;
    while (g.phase === "activation") {
      const id = E.nextActivation(g);
      if (!id) {
        E.setPhase(g, "action");
        break;
      }
      // Varicelle cosmique : avec la sentience vraie, seules les cartes en position impaire (1, 3, 5…) se jouent.
      const t = g.players[this.current].terrain;
      if (t.includes("FLE-21") && g.players[this.current].sentience && t.indexOf(id) % 2 === 1) {
        g.activated = [...(g.activated ?? []), id];
        const why = "Varicelle cosmique : seules les cartes en position impaire se jouent.";
        this.fx({ k: "fail", card: id, uid: this.current, reason: why });
        this.log(`« ${card(id).name} » ne se joue pas. ${why}`, { src: "FLE-21", dst: id });
        continue;
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
    case "play": {
      const no = SCRIPTS[a.card]?.noPlay;
      if (no) throw new Error(no);
      if (x.p(a.by).cantPlay) throw new Error(x.p(a.by).cantPlay!);
      E.playFromHand(x.room, x.g, a.by, a.card, a.target, a.index);
      x.fx({ k: "move", card: a.card });
      x.emit({ type: "placed", uid: a.target, card: a.card, src: null });
      if (E.locate(x.g, a.card)?.zone === "terrain") x.activateCard(a.card, a.by);
      break;
    }
    case "discard":
      E.discardFromHand(x.room, x.g, a.by, a.card);
      x.emit({ type: "discard", uid: a.by, card: a.card, src: null });
      break;
    case "endTurn": {
      const prev = E.hooks.drew;
      E.hooks.drew = (_g, uid, n) => x.emit({ type: "draw", uid, n, from: uid, src: null });
      try {
        E.endTurn(x.room, x.g);
      } finally {
        E.hooks.drew = prev;
      }
      break;
    }
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
    E.hooks.after?.(room, work);
    room.game = work;
  } catch (e) {
    if (!(e instanceof NeedChoice)) throw e;
    base.pending = { action: act, answers, rolls: x.rolls, prompt: e.prompt };
    room.game = base;
  } finally {
    E.RNG.next = prev;
  }
}

function defaultAnswer(p: Prompt): unknown {
  switch (p.kind) {
    case "player": return p.options[0];
    case "option": return 0;
    case "number": return p.max;
    case "cards": return p.options.slice(0, Math.max(1, p.min));
    case "order": return p.options;
    case "slot": return 0;
  }
}

export type Preview = {
  ok: boolean;
  reason?: string;
  cards: string[];
  gold: string[];
  sentience: string[];
  bh: string[];
  players: string[];
};

/**
 * Aperçu au survol : simule l'effet de la carte sur une copie de l'état (la carte est posée en fin de terrain
 * si elle est en main) et renvoie ce qu'il toucherait, ou pourquoi il est impossible.
 */
export function previewEffect(room: Room, id: string, me: string): Preview | null {
  const s = SCRIPTS[id];
  if (!room.game || !s?.activate) return null;
  const g = structuredClone(room.game);
  g.pending = null;
  const at = E.locate(g, id);
  if (!at) return null;
  const x = new Ctx({ ...room, game: g }, g, [], []);
  x.preview = [];
  const out: Preview = { ok: true, cards: [], gold: [], sentience: [], bh: [], players: [] };
  const fxStart = g.fxSeq ?? 0;
  try {
    if (at.zone === "hand") E.moveCard(x.room, g, id, { uid: me, zone: "terrain" }, true);
    x.actor = me;
    x.source = id;
    out.ok = s.activate(x, { id, me }) !== false;
  } catch {
    return null;
  }
  if (!out.ok) out.reason = x.reason ?? REASONS[id] ?? DEFAULT_REASON;
  const add = (arr: string[], v: string) => !arr.includes(v) && arr.push(v);
  for (const f of g.fx ?? []) {
    if (f.id <= fxStart) continue;
    if (f.k === "gold") add(out.gold, f.uid);
    if (f.k === "sentience") add(out.sentience, f.uid);
    if (f.k === "bh") add(out.bh, f.uid);
    if (f.k === "activate" && f.card !== id) add(out.cards, f.card);
    if (f.k === "link" && f.to !== id) add(out.cards, f.to);
  }
  // Cartes déplacées par l'effet
  const before = room.game;
  for (const [uid, p] of Object.entries(g.players)) {
    for (const zone of ["terrain", "hand", "discard", "deck"] as const) {
      for (const c of p[zone]) {
        if (c === id) continue;
        const was = E.locate(before, c);
        if (was && (was.uid !== uid || was.zone !== zone) && (was.zone === "terrain" || was.zone === "discard")) add(out.cards, c);
      }
    }
  }
  // Toutes les options proposées par les choix
  for (const p of x.preview) {
    if (p.kind === "player") p.options.forEach((u) => add(out.players, u));
    if (p.kind === "cards" && !p.blind) p.options.forEach((c) => add(out.cards, c));
    if (p.kind === "order") p.options.forEach((c) => add(out.cards, c));
  }
  return out;
}
