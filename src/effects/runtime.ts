// Résolution automatique des effets de cartes.
//
// Principe : une action (activer ses cartes, poser une carte, finir son tour) est exécutée d'un bloc.
// Si un effet a besoin d'un choix d'un joueur, l'exécution s'arrête (NeedChoice), l'état revient à
// celui d'avant l'action et la question est enregistrée dans `pending`. Quand le joueur répond,
// l'action est rejouée depuis le début avec les réponses déjà données et les mêmes tirages au hasard.
import { DEFAULT_REASON, REASONS } from "./reasons";
import { card } from "../data/cards";
import * as E from "../game/engine";
import type { BlackHole, EffectAction, FxInput, GameState, Prompt, Room, TrailStep, Until, Weather, Zone } from "../game/types";
import { BH_SYMBOL, BLACK_HOLES, blackHoleLabel, weatherIcon, weatherLabel } from "../game/types";
import { SCRIPTS } from "./scripts";
import "../game/victory";

export type Self = { id: string; me: string };
export type Loc = { uid: string; zone: Zone; index: number };
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
  /** `card` est posée sur le terrain de `uid` (venant de la zone `fromZone` de `fromUid`) */
  | { type: "placed"; uid: string; card: string; src: string | null; fromUid?: string; fromZone?: Zone }
  /** l'effet de `src` défausse `card` du terrain de `uid` */
  | { type: "terrainDiscard"; uid: string; card: string; src: string }
  /** `thief` prend une carte de `victim` sans rien donner en retour */
  | { type: "steal"; thief: string; victim: string; card: string; src?: string | null; from?: Loc }
  /** `thief` vole `amount` gold à `victim` */
  | { type: "goldStolen"; thief: string; victim: string; amount: number; src: string | null }
  /** début / fin du tour de `uid` */
  /** une carte change de place à cause d'un effet ou d'une défausse de main (to = null : elle a quitté les zones) */
  | { type: "cardMoved"; card: string; from: Loc; to: Loc | null; src: string | null }
  | { type: "turnStart"; uid: string }
  /** la météo de `uid` change (deck Météo) */
  | { type: "weather"; uid: string; from: Weather | null; to: Weather | null }
  /** l'effet de `card` vient d'être joué pour `uid` */
  | { type: "activated"; uid: string; card: string }
  | { type: "turnEnd"; uid: string };

type Handlers = { [K in GameEvent["type"]]: (x: Ctx, self: Self, e: Extract<GameEvent, { type: K }>) => void };
export type CardScript = {
  /** Effet activé (pose ou phase d'activation). Renvoie false si l'effet n'a pas pu s'appliquer. */
  activate?: (x: Ctx, self: Self) => boolean | void;
  /** Passifs : réagissent aux événements tant que la carte est sur un terrain. */
  on?: Partial<Handlers>;
  /** ne peut pas être défaussée par un effet */
  fixed?: boolean;
  /** ne peut pas être posée depuis la main (raison affichée) */
  noPlay?: string | ((g: GameState, id: string) => string | null | undefined);
  /** après chaque déplacement de la carte elle-même (pose, changement de place ou de terrain, départ) */
  onMove?: (x: Ctx, self: Self, from: Loc | null, to: Loc | null) => void;
  /** juste avant que la carte quitte les terrains */
  beforeLeave?: (x: Ctx, self: Self) => void;
  /** ne peut être déplacée par l'effet d'un autre joueur qu'avec l'accord de son possesseur */
  guarded?: boolean;
  /** ses passifs écoutent aussi quand elle est face visible dans une main */
  inHand?: boolean;
  /** ne peut arriver sur un terrain que par l'effet de cette carte */
  placedOnlyBy?: string | string[];
  /** sur un terrain, ne peut être déplacée (défausse, vol…) que par ses propres effets et ceux de ces cartes */
  immovableExcept?: string[];
};

export const isAutomated = (id: string) => !!SCRIPTS[id];

/** Carte d'un terrain dont le déplacement est bloqué (chaînes affichées) : raison et carte à l'origine, sinon null. */
export function chainOf(g: GameState, id: string): { why: string; src: string } | null {
  const at = E.locate(g, id);
  if (!at || at.zone !== "terrain") return null;
  const sc = SCRIPTS[id];
  const tar = E.locate(g, "EMI-30");
  if (id !== "EMI-30" && tar?.zone === "terrain" && tar.uid === at.uid && !E.isDisabled(g, "EMI-30") && (g.armed ?? []).includes("EMI-30"))
    return { why: "Goudron : les cartes de ce terrain sont fixées, aucun effet ne peut les déplacer.", src: "EMI-30" };
  if (sc?.immovableExcept)
    return { why: `Ne peut être déplacée que par ses propres effets${sc.immovableExcept.length ? ` et ceux de ${sc.immovableExcept.map((c) => `« ${card(c).name} »`).join(", ")}` : ""}.`, src: id };
  if (sc?.fixed) return { why: "Ne peut pas être défaussée par un effet.", src: id };
  if (sc?.guarded) return { why: "Un autre joueur ne peut la déplacer qu'avec l'accord de son possesseur.", src: id };
  return null;
}
/** Pourquoi la carte ne peut pas être posée depuis la main (null = elle peut). */
export function noPlayReason(g: GameState, id: string): string | null {
  const np = SCRIPTS[id]?.noPlay;
  return (typeof np === "function" ? np(g, id) : np) ?? null;
}

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
  /** joueurs dont les choix se font au hasard (Crapaud stratège) */
  private forcedRandom: string[] = [];
  private actDepth = 0;
  /** joueur dont l'effet a déplacé la carte (pendant `onMove`) */
  mover: string | null = null;
  /** garde-fous contre les boucles (passifs qui se relancent eux-mêmes) */
  private busy = new Set<string>();
  /** pourquoi l'effet en cours a échoué (gold manquant, aucune cible, paiement refusé) */
  reason: string | null = null;

  /** Mode aperçu : les questions reçoivent une réponse par défaut et sont mémorisées. */
  public preview: Prompt[] | null = null;

  constructor(public room: Room, public g: GameState, private answers: string[], public rolls: number[]) {}
  /** Choix déjà faits pendant cette action, en clair (aide affichée pendant les choix suivants). */
  trail: TrailStep[] = [];
  private answerLabel(p: Prompt, a: unknown): string {
    const cards = (ids: unknown) => (Array.isArray(ids) ? ids.map((c) => `« ${card(String(c)).name} »`).join(", ") : "");
    switch (p.kind) {
      case "player": return this.p(String(a)) ? this.name(String(a)) : "personne";
      case "option": return p.options[Number(a)] ?? "—";
      case "number": return String(a);
      case "cards": return !Array.isArray(a) || !a.length ? (p.max === 0 ? "vu" : "aucune") : p.blind ? `${a.length} carte(s) cachée(s)` : cards(a);
      case "order": return "ordre choisi";
      case "slot": return `place ${Number(a) + 1} chez ${this.name(p.uid)}`;
    }
  }

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

  /** Dé de sentience (2 faces : Vraie, Fausse). */
  sentDice(uid: string): boolean {
    const v = 1 + Math.floor(this.rand() * 2);
    this.fx({ k: "dice", uid, faces: 2, value: v, sent: true });
    this.log(`🎲 ${this.name(uid)} lance le dé de sentience : ${v === 1 ? "Vraie" : "Fausse"}.`);
    return v === 1;
  }
  /** Chance sur 100 (affichée comme un d100 réussi si ≤ pct). */
  chance(uid: string, pct: number): boolean {
    return this.dice(uid, 100) <= pct;
  }
  /** Joueur tiré au hasard parmi `list`, annoncé dans le journal. */
  randomPlayer(list: string[]): string | null {
    if (!list.length) {
      this.reason = "Aucune cible possible.";
      return null;
    }
    const u = this.random(list);
    this.log(`🎯 Cible tirée au hasard : ${this.name(u)}.`, { to: u });
    return u;
  }

  /** Exécute `fn` une seule fois à la fois pour `key` (évite qu'un passif se relance lui-même). */
  once(key: string, fn: () => void) {
    if (this.busy.has(key)) return;
    this.busy.add(key);
    try {
      fn();
    } finally {
      this.busy.delete(key);
    }
  }

  // ----- choix des joueurs -----
  private randomAnswer(p: Prompt): unknown {
    const r = (n: number) => Math.floor(this.rand() * n);
    switch (p.kind) {
      case "player": return p.options[r(p.options.length)];
      case "option": return r(p.options.length);
      case "number": return p.min + r(p.max - p.min + 1);
      case "cards": {
        const pool = [...p.options];
        const n = Math.max(p.min, Math.min(p.max, 1));
        const out: string[] = [];
        while (out.length < n && pool.length) out.push(pool.splice(r(pool.length), 1)[0]);
        return out;
      }
      case "order": {
        const pool = [...p.options];
        const out: string[] = [];
        while (pool.length) out.push(pool.splice(r(pool.length), 1)[0]);
        return out;
      }
      case "slot": return r(this.p(p.uid).terrain.length + 1);
    }
  }
  private ask<T>(prompt: Prompt): T {
    if (!prompt.cardId && this.source) prompt = { ...prompt, cardId: this.source };
    if (this.forcedRandom.includes(prompt.chooser) && !this.preview) return this.randomAnswer(prompt) as T;
    if (this.ai < this.answers.length) {
      const a = JSON.parse(this.answers[this.ai++]) as T;
      if (!this.preview) this.trail.push({ card: prompt.cardId ?? "", chooser: prompt.chooser, text: prompt.text, label: this.answerLabel(prompt, a) });
      return a;
    }
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
    return opts[this.chooseOption(chooser, text, opts.map((b) => `${BH_SYMBOL[b.id]} ${blackHoleLabel(b.id)}`), cardId)].id;
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
      for (const id of p.hand) if (this.g.revealed?.includes(id) && SCRIPTS[id]?.inHand && !out.some((o) => o[1] === id)) out.push([uid, id, "hand"]);
    }
    return out.filter(([, id, zone]) => zone !== "terrain" || !E.isDisabled(this.g, id));
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

  // ----- protections (Rêverie, Victor) -----
  /**
   * Rêve d'amitié / Cauchemar d'emprisonnement : pendant son tour, l'acteur ne peut pas toucher `target`.
   * `harm` = l'effet nuit à `target` (perte de gold, cartes prises, déplacées ou désactivées). Renvoie true si l'effet est empêché.
   */
  shielded(target: string, harm: boolean): boolean {
    const a = this.actor;
    if (!a || a === target || a !== this.current || !this.p(target)) return false;
    const P = E.pos(this.g);
    const s = (this.g.shields ?? []).find((s) => s.by === a && P > s.after && (s.prot === "*" || (harm && s.prot === target)));
    if (!s) return false;
    const jail = s.prot === "*";
    const why = jail
      ? `Cauchemar d'emprisonnement : ${this.name(a)} ne peut pas interagir avec les autres joueurs ce tour.`
      : `Rêve d'amitié : ${this.name(a)} ne peut pas nuire à ${this.name(target)} ce tour.`;
    this.log(`🛡 ${why}`, { src: jail ? "REV-17" : "REV-10", to: target });
    this.reason = why;
    return true;
  }
  /**
   * Piège à Gobelin : un autre joueur veut modifier le terrain de `uid` (ajout, retrait, échange, ordre).
   * L'action est empêchée, il paie 50 gold (sinon `uid` vole une carte de son terrain) et le piège est défaussé.
   */
  trapped(uid: string): boolean {
    const a = this.actor;
    if (!a || a === uid || this.source === "VIC-19" || !this.p(a) || !this.p(uid) || !this.active("VIC-19", uid)) return false;
    this.triggered({ id: "VIC-19", me: uid }, `${this.name(a)} veut modifier le terrain de ${this.name(uid)} : l'action est empêchée.`);
    this.runAs("VIC-19", uid, () => {
      if (this.p(a).gold >= 50) this.giveBack(a, uid, 50);
      else {
        this.log(`${this.name(a)} n'a pas 50 gold : ${this.name(uid)} vole une carte de son terrain.`);
        const c = this.chooseCard(uid, `Piège à Gobelin : quelle carte du terrain de ${this.name(a)} voler ?`, this.p(a).terrain, "VIC-19");
        if (c && this.move(c, { uid, zone: "hand" })) this.take(c, uid);
      }
      this.move("VIC-19", { uid, zone: "discard" });
    });
    this.reason = "Piège à Gobelin : l'action est empêchée.";
    return true;
  }
  /** L'acteur peut-il changer l'ordre du terrain de `uid` ? (protections, Piège à Gobelin) */
  canReorder(uid: string) {
    return !this.shielded(uid, true) && !this.trapped(uid);
  }

  // ----- ressources -----
  gain(uid: string, n: number): number {
    n = Math.trunc(n);
    if (n <= 0) return 0;
    if (uid !== this.actor && this.shielded(uid, false)) return 0;
    // Tung Tung Tung Sahur (Trou de ver) : les gold gagnés par les autres sont aspirés.
    const asp = this.g.aspire;
    if (asp && asp.uid !== uid && this.p(asp.uid) && E.pos(this.g) <= asp.until) {
      this.log(`🌪 Tung Tung Tung Sahur : les ${n} gold de ${this.name(uid)} sont aspirés par ${this.name(asp.uid)}.`, { src: "EMI-10" });
      uid = asp.uid;
    }
    // Gravité grave : tant qu'elle est sur un terrain, toutes les sources de gold rapportent 1 gold de plus.
    if (E.locate(this.g, "EMI-20")?.zone === "terrain" && !E.isDisabled(this.g, "EMI-20")) n += 1;
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
    if (uid !== this.actor && this.shielded(uid, true)) return 0;
    const p = this.p(uid);
    const real = p.allowNegativeGold ? n : Math.min(n, Math.max(0, p.gold));
    if (real <= 0) return 0;
    p.gold -= real;
    E.st(p).lost = (E.st(p).lost ?? 0) + real;
    if (uid === this.current) E.st(p).lostTurn = (E.st(p).lostTurn ?? 0) + real;
    this.fx({ k: "gold", uid, delta: -real });
    this.log(`${this.name(uid)} perd ${real} gold (${p.gold}).`, { to: uid });
    this.interact(uid, "gold");
    this.emit({ type: "goldLost", uid, amount: real });
    if (p.gold === 0) this.emit({ type: "zeroGold", uid });
    return real;
  }
  /** ADS : les coûts de son joueur (ou de tous, s'il était Primordial) sont doublés. */
  cost(uid: string, n: number) {
    const at = E.locate(this.g, "EMI-13");
    if (!at || at.zone !== "terrain" || E.isDisabled(this.g, "EMI-13")) return n;
    return at.uid === uid || this.g.marks?.["EMI-13"] === "all" ? n * 2 : n;
  }
  canPay(uid: string, n: number) {
    n = this.cost(uid, n);
    const p = this.p(uid);
    const ok = p.allowNegativeGold || p.gold >= n;
    if (!ok) this.reason = `Pas assez de gold : ${n} requis, ${this.name(uid)} en a ${p.gold}.`;
    return ok;
  }
  /** Dépense : échoue (et ne retire rien) si le joueur n'a pas assez de gold. */
  spend(uid: string, n: number): boolean {
    if (n <= 0) return true;
    if (!this.canPay(uid, n)) {
      n = this.cost(uid, n);
      this.log(`${this.name(uid)} n'a pas assez de gold (${n} requis).`);
      return false;
    }
    const c = this.cost(uid, n);
    if (c !== n) this.log(`📺 ADS : le coût est doublé (${c} gold).`, { src: "EMI-13" });
    this.lose(uid, c);
    const s = E.st(this.p(uid));
    s.spent = (s.spent ?? 0) + c;
    if (uid === this.current) s.spentTurn = (s.spentTurn ?? 0) + c;
    return true;
  }
  transfer(from: string, to: string, n: number): number {
    // Protections : rien ne passe si l'autre joueur est protégé (sans gold perdus en route).
    const other = from === this.actor ? to : from;
    if (from !== to && this.shielded(other, other === from)) return 0;
    const stolen = from !== to && this.actor === to && !this.exchanging;
    // Rainette spéculative : un vol de gold est remplacé par un d100.
    if (stolen && n > 0 && this.active("GRE-24", from)) {
      this.log(`🐸 Rainette spéculative : le montant volé à ${this.name(from)} est remplacé par un d100.`, { src: "GRE-24" });
      n = this.dice(from, 100);
    }
    const real = this.lose(from, n);
    if (real) this.gain(to, real);
    if (from !== to) this.moved(real);
    if (stolen && real > 0) this.emit({ type: "goldStolen", thief: to, victim: from, amount: real, src: this.source });
    return real;
  }
  /** Rend des gold sans que cela compte comme un vol. */
  giveBack(from: string, to: string, n: number) {
    this.exchanging++;
    try {
      return this.transfer(from, to, n);
    } finally {
      this.exchanging--;
    }
  }
  /** Échange les gold de deux joueurs. */
  swapGold(a: string, b: string) {
    const ga = this.p(a).gold;
    const gb = this.p(b).gold;
    if (ga === gb) return;
    // Une dette (gold négatifs, Fléaux) ne passe pas à un joueur qui ne peut pas descendre sous 0.
    this.p(a).gold = this.p(a).allowNegativeGold ? gb : Math.max(0, gb);
    this.p(b).gold = this.p(b).allowNegativeGold ? ga : Math.max(0, ga);
    const loser = this.p(ga > gb ? a : b);
    E.st(loser).lost = (E.st(loser).lost ?? 0) + Math.abs(ga - gb);
    if ((ga > gb ? a : b) === this.current) E.st(loser).lostTurn = (E.st(loser).lostTurn ?? 0) + Math.abs(ga - gb);
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
  /** Météo d'un joueur (Orage sur son terrain = Orage). */
  weather = (uid: string) => E.weatherOf(this.g, uid);
  setWeather(uid: string, w: Weather | null) {
    const p = this.p(uid);
    if (!p) return;
    const from = this.weather(uid);
    p.weather = w;
    const to = this.weather(uid);
    if (from === to) {
      this.log(`${this.name(uid)} garde sa météo ${weatherIcon(to)} ${weatherLabel(to)}.`);
      return;
    }
    this.announceWeather(uid, from, to);
  }
  private announceWeather(uid: string, from: Weather | null, to: Weather | null) {
    this.fx({ k: "weather", uid, to });
    this.log(`${weatherIcon(to)} Météo de ${this.name(uid)} : ${weatherLabel(from)} → ${weatherLabel(to)}.`, { to: uid });
    this.interact(uid, "météo");
    this.emit({ type: "weather", uid, from, to });
    this.thawSnow();
  }
  /** Neige parfaite : quand plus aucun joueur n'a la neige, les cartes ensevelies sont mélangées et redistribuées. */
  thawSnow() {
    const buried = this.g.under?.[E.SNOW] ?? [];
    if (!buried.length || this.turnOrder().some((u) => this.weather(u) === "Neige")) return;
    const homes = buried.map((c) => this.g.underFrom?.[c]?.uid ?? this.g.owner[c] ?? this.current);
    const cards = E.shuffle([...buried]);
    this.log(`🌤️ La neige fond : ${cards.length} carte${cards.length > 1 ? "s" : ""} ensevelie${cards.length > 1 ? "s sont mélangées et redistribuées" : " revient"}.`);
    cards.forEach((c, i) => {
      const u = this.p(homes[i]) ? homes[i] : this.current;
      E.detachUnder(this.g, c, { uid: u, zone: "terrain" });
      this.fx({ k: "move", card: c });
      this.log(`❄️ « ${card(c).name} » ressort de la neige sur le terrain de ${this.name(u)}.`, { dst: c, to: u });
      this.placedActivate(c, u);
    });
  }
  /** L'Orage change de terrain : la météo des deux joueurs change avec lui. */
  private orageMoved(at: Loc | null, now: Loc | null) {
    const a = at?.zone === "terrain" ? at.uid : null;
    const b = now?.zone === "terrain" ? now.uid : null;
    if (a === b) return;
    if (a) this.announceWeather(a, "Orage", this.weather(a));
    if (b) this.announceWeather(b, this.p(b).weather ?? null, "Orage");
  }
  setSentience(uid: string, v: boolean) {
    const p = this.p(uid);
    if (p.sentience === v) return;
    if (p.locked) return this.log(`🔒 ${this.name(uid)} est bloqué : sa sentience ne change pas.`);
    if (this.shielded(uid, false)) return;
    // Rêveur : les changements de sentience venant des autres joueurs ne touchent pas son joueur.
    if (this.actor && this.actor !== uid && this.active("REV-01", uid)) {
      return this.log(`💤 Rêveur : la sentience de ${this.name(uid)} ne change pas (effet d'un autre joueur).`, { src: "REV-01", to: uid });
    }
    p.sentience = v;
    E.st(p).sentFlips = (E.st(p).sentFlips ?? 0) + 1;
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
    if (this.shielded(uid, false)) return;
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
  /** La carte `id` (sur un terrain, de `holder`) a-t-elle son effet actif ? */
  active(id: string, holder?: string) {
    const at = E.locate(this.g, id);
    return !!at && at.zone === "terrain" && (!holder || at.uid === holder) && !E.isDisabled(this.g, id);
  }
  /** Une carte d'un terrain peut-elle être déplacée par l'effet en cours ? (Goudron, cartes protégées, Grenouille tampon) */
  private canDisplace(id: string, at: Loc, dest: E.Dest | null): boolean {
    const src = this.source;
    if (at.zone !== "terrain" || !src || src === id) return true;
    const imm = SCRIPTS[id]?.immovableExcept;
    if (imm && !imm.includes(src)) {
      this.log(`🛡 « ${card(id).name} » ne peut pas être déplacée.`, { dst: id });
      this.reason = `« ${card(id).name} » ne peut pas être déplacée.`;
      return false;
    }
    if (this.active("EMI-30", at.uid) && (this.g.armed ?? []).includes("EMI-30") && id !== "EMI-30") {
      this.log(`🛢 Goudron : les cartes de ${this.name(at.uid)} sont fixées, « ${card(id).name} » ne bouge pas.`, { dst: id, src: "EMI-30" });
      this.reason = "Goudron : les cartes de ce terrain sont fixées.";
      return false;
    }
    const owner = this.g.owner[id] ?? at.uid;
    if (SCRIPTS[id]?.guarded && this.actor !== owner && this.p(owner)) {
      if (!this.confirm(owner, `Autoriser l'effet de « ${card(src).name} » à déplacer ta carte « ${card(id).name} » ?`, id)) {
        this.log(`🛡 ${this.name(owner)} refuse de laisser déplacer « ${card(id).name} ».`, { dst: id });
        return false;
      }
    }
    const leaves = !dest || dest.zone !== "terrain" || dest.uid !== at.uid;
    if (leaves && id !== "GRE-19" && this.active("GRE-19", at.uid)) {
      this.log(`🐸 Grenouille tampon : elle part à la place de « ${card(id).name} ».`, { src: "GRE-19", dst: id });
      const prev = this.source;
      this.source = "GRE-19";
      try {
        this.move("GRE-19", { uid: at.uid, zone: "discard" });
      } finally {
        this.source = prev;
      }
      return false;
    }
    return true;
  }
  /** Lance la réaction d'une carte à son propre déplacement. */
  private afterMove(id: string, from: Loc | null) {
    const h = SCRIPTS[id]?.onMove;
    if (!h) return;
    const now = E.locate(this.g, id);
    if (now?.zone === "terrain" && E.isDisabled(this.g, id)) return;
    this.mover = this.actor;
    this.once(`move:${id}`, () => this.runAs(id, now?.uid ?? from?.uid ?? this.current, () => h(this, { id, me: now?.uid ?? from?.uid ?? this.current }, from, now)));
  }
  /** Exécute `fn` comme si la carte `id` de `me` agissait. */
  runAs(id: string, me: string, fn: () => void) {
    const prevActor = this.actor;
    const prevSource = this.source;
    this.actor = me;
    this.source = id;
    try {
      fn();
    } finally {
      this.actor = prevActor;
      this.source = prevSource;
    }
  }

  /**
   * Déplace une carte. Une carte qui arrive sur un terrain depuis une autre zone active son effet
   * (pour le joueur du terrain, ou `opts.activate`), sauf `opts.activate === false`.
   * Un déplacement d'un terrain à un autre n'active rien.
   */
  move(id: string, dest: E.Dest, opts: { activate?: false | string } = {}): boolean {
    const at = E.locate(this.g, id);
    const src = this.source;
    if (!at) return false;
    if ([at.uid, dest.uid].some((u) => this.shielded(u, true))) return false;
    if (at.zone === "terrain" && this.trapped(at.uid)) return false;
    if (dest.zone === "terrain" && this.trapped(dest.uid)) return false;
    if (!this.canDisplace(id, at, dest)) return false;
    // Cacapulte : une carte qui doit aller dans la défausse de son joueur peut aller dans celle d'un autre.
    if (dest.zone === "discard" && id !== "VIC-17" && this.active("VIC-17", dest.uid) && this.order.length > 1) {
      const holder = dest.uid;
      const u = this.choosePlayer(holder, `Cacapulte : dans quelle défausse envoyer « ${card(id).name} » ?`, [holder, ...this.others(holder)], "VIC-17");
      if (u && u !== holder) {
        this.log(`💩 Cacapulte : « ${card(id).name} » part dans la défausse de ${this.name(u)}.`, { src: "VIC-17", dst: id, to: u });
        dest = { ...dest, uid: u };
      }
    }
    if (at.zone === "terrain" && dest.zone !== "terrain") SCRIPTS[id]?.beforeLeave?.(this, { id, me: at.uid });
    if (!E.locate(this.g, id)) return false;
    if (at?.zone === "terrain" && dest.zone === "discard" && SCRIPTS[id]?.fixed && src !== id) {
      this.log(`🛡 « ${card(id).name} » ne peut pas être défaussée.`, { dst: id });
      return false;
    }
    // Double jeu : les cartes cachées dessous seront révélées et posées à sa place quand elle quitte le terrain.
    const hiddenUnder = at.zone === "terrain" && dest.zone !== "terrain" ? (this.g.under?.[id] ?? []).filter((c) => this.g.marks?.[c] === "VIC-13") : [];
    if (hiddenUnder.length) {
      const rest = (this.g.under?.[id] ?? []).filter((c) => !hiddenUnder.includes(c));
      const u = { ...this.g.under };
      if (rest.length) u[id] = rest;
      else delete u[id];
      this.g.under = u;
    }
    const only = SCRIPTS[id]?.placedOnlyBy;
    const onlyList = only ? (Array.isArray(only) ? only : [only]) : [];
    if (only && dest.zone === "terrain" && at?.zone !== "terrain" && !onlyList.includes(src ?? "")) {
      this.log(`🚫 « ${card(id).name} » ne peut être posée que par ${onlyList.map((o) => `« ${card(o).name} »`).join(" ou ")}.`, { dst: id });
      return false;
    }
    E.moveCard(this.room, this.g, id, dest, !!(src && src !== id && at));
    if (hiddenUnder.length) {
      const m = { ...(this.g.marks ?? {}) };
      hiddenUnder.forEach((c, k) => {
        delete m[c];
        const t = this.p(at.uid).terrain;
        t.splice(Math.min(at.index + k, t.length), 0, c);
        this.g.born = { ...(this.g.born ?? {}), [c]: E.pos(this.g) };
        this.fx({ k: "move", card: c });
        this.log(`🎭 Double jeu : « ${card(c).name} » était cachée dessous, elle est révélée et posée à sa place.`, { src: "VIC-13", dst: c, to: at.uid });
      });
      this.g.marks = m;
    }
    if (src && src !== id && at) this.linkMove(src, id, at.uid, dest);
    if (dest.zone === "discard" && src && this.actor && at.uid !== this.actor && (at.zone === "terrain" || at.zone === "hand") && this.p(this.actor)) {
      const s = E.st(this.p(this.actor));
      s.discOthers = (s.discOthers ?? 0) + 1;
    }
    if (dest.zone === "terrain" && !(this.g.movedCards ?? []).includes(id)) this.g.movedCards = [...(this.g.movedCards ?? []), id];
    if (dest.zone === "terrain" && src && (this.g.owner[id] ?? at.uid) !== dest.uid) this.noteOrigin("elsewhere", id);
    this.touchCard(id, dest.zone === "terrain" ? dest.uid : null);
    if (at) this.interact(at.uid, at.zone);
    this.fx({ k: "move", card: id });
    const now = E.locate(this.g, id);
    const actor = this.actor;
    this.afterMove(id, at);
    if (at && now && actor && !this.exchanging && at.uid !== actor && now.uid === actor && this.p(at.uid))
      this.emit({ type: "steal", thief: actor, victim: at.uid, card: id, src, from: at });
    if (at?.zone === "terrain" && now?.zone !== "terrain" && src && src !== id && dest.zone === "discard")
      this.emit({ type: "terrainDiscard", uid: at.uid, card: id, src });
    if (now?.zone === "terrain" && at && at.zone !== "terrain") this.emit({ type: "placed", uid: now.uid, card: id, src, fromUid: at.uid, fromZone: at.zone });
    if (at) this.emit({ type: "cardMoved", card: id, from: at, to: now, src });
    if (id === E.ORAGE) this.orageMoved(at, now);
    if (now?.zone === "terrain" && at && at.zone !== "terrain" && opts.activate !== false) this.placedActivate(id, opts.activate ?? now.uid);
    for (const c of hiddenUnder) {
      const l = E.locate(this.g, c);
      if (l?.zone === "terrain") this.placedActivate(c, l.uid);
    }
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
    if ([pa.uid, pb.uid].some((u) => this.shielded(u, true))) return;
    if ((pa.zone === "terrain" && this.trapped(pa.uid)) || (pb.zone === "terrain" && this.trapped(pb.uid))) return;
    if (!this.canDisplace(a, pa, pb) || !this.canDisplace(b, pb, pa)) return;
    if (!E.locate(this.g, a) || !E.locate(this.g, b)) return;
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
    this.afterMove(a, pa);
    this.afterMove(b, pb);
    this.emit({ type: "cardMoved", card: a, from: pa, to: E.locate(this.g, a), src: this.source });
    this.emit({ type: "cardMoved", card: b, from: pb, to: E.locate(this.g, b), src: this.source });
    if (pb.zone === "terrain" && pa.zone !== "terrain") this.placedActivate(a, pb.uid);
    if (pa.zone === "terrain" && pb.zone !== "terrain") this.placedActivate(b, pa.uid);
  }
  /** Carte posée sur un terrain par un effet : son effet s'active (une seule fois ce tour). */
  placedActivate(id: string, who: string) {
    const at = E.locate(this.g, id);
    if (at?.zone !== "terrain" || !this.canActivate(id)) return;
    const g = this.g;
    if (at.uid === this.current && g.phase === "activation") {
      if ((g.activated ?? []).includes(id)) return;
      g.activated = [...(g.activated ?? []), id];
    }
    this.activateCard(id, who);
  }
  /** Déplace sans compter de vol (échanges en plusieurs morceaux). */
  moveExchange(id: string, dest: E.Dest, opts: { activate?: false | string } = {}) {
    this.exchanging++;
    try {
      return this.move(id, dest, opts);
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
    const tg = E.tagsOf(this.g, id);
    const opts = (["s", "g", "b"] as const).filter((k) => (k === "s" ? tg.sentience : k === "g" ? tg.gold : tg.blackHole));
    if (!opts.length) return;
    // Une carte à plusieurs tags compte pour le tag le moins rempli.
    const k = opts.reduce((a, b) => (t[b].length < t[a].length ? b : a));
    s.cardTags = { ...t, [k]: [...t[k], id] };
  }
  // ----- désactivation & cartes placées dessous -----
  /** Fin du prochain tour de `uid` (ou du tour en cours si c'est encore le sien… et qu'il n'est pas commencé). */
  untilEndOfNext = (uid: string): Until => ({ uid, edge: "end", after: E.pos(this.g) });
  /** Début du prochain tour de `uid`. */
  untilStartOfNext = (uid: string): Until => ({ uid, edge: "start", after: E.pos(this.g) });
  /** Fin du tour en cours. */
  untilEndOfTurn = (): Until => ({ uid: this.current, edge: "end", after: E.pos(this.g) - 1 });
  private untilLabel(u?: Until) {
    if (!u) return "";
    if (u.after < E.pos(this.g)) return " jusqu'à la fin du tour";
    return u.edge === "start" ? ` jusqu'au début du prochain tour de ${this.name(u.uid)}` : ` jusqu'à la fin du prochain tour de ${this.name(u.uid)}`;
  }
  isDisabled = (id: string) => E.isDisabled(this.g, id);
  /** Désactive une carte d'un terrain (sans `until` : jusqu'à nouvel ordre). */
  disable(id: string, until?: Until): boolean {
    const at = E.locate(this.g, id);
    if (!at || at.zone !== "terrain") return false;
    if (this.shielded(at.uid, true)) return false;
    const c = this.g.custody;
    if (c && c.host !== id && this.active(c.host)) {
      this.putUnder(id, c.host);
      this.log(`🚔 Garde à vue : « ${card(id).name} » est placée sous « ${card(c.host).name} ».`, { src: c.host, dst: id });
      if ((this.g.under?.[c.host]?.length ?? 0) > 4) this.releaseCustody(true);
      return true;
    }
    E.disableCard(this.g, id, until);
    // Origine de la désactivation (affichée dans le détail de la carte) — jamais de valeur `undefined` (Firestore).
    const by: { src?: string; by?: string; at: number } = { at: E.pos(this.g) };
    if (this.source && this.source !== id) by.src = this.source;
    if (this.actor) by.by = this.actor;
    this.g.disabledBy = { ...(this.g.disabledBy ?? {}), [id]: by };
    this.fx({ k: "fail", card: id, uid: at.uid, reason: "Désactivée" });
    if (this.source && this.source !== id) this.fx({ k: "link", from: this.source, to: id, toUid: at.uid, text: `désactive « ${card(id).name} »` });
    this.log(`⛔ « ${card(id).name} » (${this.name(at.uid)}) est désactivée${this.untilLabel(until)}.`, { dst: id, to: at.uid });
    this.interact(at.uid, "carte");
    return true;
  }
  enable(id: string) {
    if (E.enableCard(this.g, id)) this.log(`✅ « ${card(id).name} » est réactivée.`, { dst: id });
  }
  /** Retient la carte et le joueur à l'origine d'une modification (affichés dans le détail de la carte). */
  noteOrigin(kind: string, id: string) {
    const o: { src?: string; by?: string } = {};
    if (this.source && this.source !== id) o.src = this.source;
    if (this.actor) o.by = this.actor;
    this.g.origins = { ...(this.g.origins ?? {}), [`${kind}:${id}`]: o };
  }
  /** Place `id` sous la carte `host` (elle quitte sa zone). */
  putUnder(id: string, host: string) {
    const at = E.locate(this.g, id);
    if (!at) return;
    E.attachUnder(this.g, id, host);
    this.noteOrigin("under", id);
    const h = E.locate(this.g, host);
    if (this.source && this.source !== id) this.fx({ k: "link", from: this.source, to: host, toUid: h?.uid, text: `place « ${card(id).name} » dessous` });
    this.interact(at.uid, at.zone);
  }
  /** Garde à vue : les cartes dessous retournent à leur place, réactivées. */
  releaseCustody(disableHost: boolean) {
    const c = this.g.custody;
    if (!c) return;
    this.g.custody = null;
    const list = [...(this.g.under?.[c.host] ?? [])];
    for (const id of list) {
      const from = this.g.underFrom?.[id];
      const uid = from && this.p(from.uid) ? from.uid : this.g.owner[id] ?? c.uid;
      E.detachUnder(this.g, id, { uid, zone: "terrain", index: from?.index });
    }
    if (list.length) this.log(`🚔 Garde à vue levée : ${list.map((id) => `« ${card(id).name} »`).join(", ")} retournent à leur place, réactivées.`, { src: c.host });
    if (disableHost && E.locate(this.g, c.host)?.zone === "terrain") this.disable(c.host, this.untilStartOfNext(c.uid));
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
    if (E.isDisabled(this.g, id)) {
      this.fx({ k: "fail", card: id, uid: me, reason: "Désactivée" });
      this.log(`⛔ « ${c.name} » est désactivée : son effet ne se joue pas.`, { dst: id });
      return;
    }
    if (this.g.hot?.includes(id)) {
      this.g.hot = this.g.hot.filter((c) => c !== id);
      if (this.dice(me, 2) === 2) {
        this.fx({ k: "fail", card: id, uid: me, reason: "Hot" });
        this.log(`☀️ Hot : « ${c.name} » ne se joue pas (2 au d2).`, { dst: id, src: "MET-05" });
        return;
      }
      this.log(`☀️ Hot : « ${c.name} » se joue (1 au d2).`, { dst: id, src: "MET-05" });
    }
    const at0 = E.locate(this.g, id);
    if (at0?.zone === "terrain" && id !== E.ORAGE && id !== "MET-30" && this.p(at0.uid).terrain.includes(E.ORAGE) && !E.isDisabled(this.g, E.ORAGE)) {
      const t = E.tagsOf(this.g, id);
      if (t.sentience || t.gold) {
        this.fx({ k: "fail", card: id, uid: me, reason: "Orage" });
        this.log(`⛈️ Orage : « ${c.name} » (Sentience ou Gold) ne peut pas être jouée.`, { dst: id, src: E.ORAGE });
        return;
      }
    }
    if (this.actDepth >= MAX_DEPTH) {
      this.log(`« ${c.name} » : trop d'effets en chaîne, celui-ci est ignoré.`);
      return;
    }
    // Parasite doré : l'effet de la carte sous laquelle il se cache concerne son joueur.
    const para = (this.g.under?.[id] ?? []).includes("VIC-09") ? this.g.marks?.["VIC-09"] : undefined;
    if (para && para !== me && this.p(para)) {
      this.log(`🪱 Parasite doré : l'effet de « ${c.name} » concerne ${this.name(para)}.`, { src: "VIC-09", dst: id, to: para });
      me = para;
    }
    const strat = (this.g.under?.[id] ?? []).includes("GRE-21");
    if (strat) {
      this.log(`🐸 Crapaud stratège : les choix de « ${c.name} » se font au hasard.`, { src: "GRE-21", dst: id });
      this.forcedRandom.push(me);
    }
    this.actDepth++;
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
      const res = s.activate(this, { id, me });
      if (res !== false) this.emit({ type: "activated", uid: me, card: id });
      if (res === false) {
        const why = this.reason ?? REASONS[id] ?? DEFAULT_REASON;
        this.fx({ k: "fail", card: id, uid: me, reason: why });
        if (me === this.current && this.g.phase === "activation") E.st(this.p(me)).failed = (E.st(this.p(me)).failed ?? 0) + 1;
        this.log(`« ${c.name} » : effet impossible. ${why}`);
      }
    } finally {
      this.actor = prevActor;
      this.source = prevSource;
      this.actDepth--;
      if (strat) this.forcedRandom.splice(this.forcedRandom.lastIndexOf(me), 1);
      E.markSpent(this.g, id);
    }
  }

  /** Carte posée depuis la main : réaction à son propre déplacement. */
  played(id: string, from: Loc | null) {
    this.afterMove(id, from);
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
      if (g.facedown?.includes(id)) {
        g.facedown = g.facedown.filter((c) => c !== id);
        E.enableCard(g, id);
        g.activated = [...(g.activated ?? []), id];
        this.fx({ k: "move", card: id });
        this.log(`👁 « ${card(id).name} » se retourne face visible et se réactive, sans jouer son effet ce tour.`, { dst: id });
        continue;
      }
      const skip = E.isDisabled(g, id)
        ? "Désactivée : son effet ne se joue pas."
        : t[t.indexOf(id) - 1] === "EMI-13" && !E.isDisabled(g, "EMI-13")
          ? "ADS : la carte qui suit ADS ne se joue pas."
          : null;
      if (skip) {
        g.activated = [...(g.activated ?? []), id];
        this.fx({ k: "fail", card: id, uid: this.current, reason: skip });
        this.log(`« ${card(id).name} » ne se joue pas. ${skip}`, { dst: id });
        continue;
      }
      if (!SCRIPTS[id]) return; // carte manuelle : le joueur l'applique lui-même
      g.activated = [...(g.activated ?? []), id];
      this.activateCard(id, this.current);
      if (g.doubleNow === this.current && this.active(id, this.current)) {
        this.log(`⛵ Voile : « ${card(id).name} » se joue une deuxième fois.`, { src: "PIR-08", dst: id });
        this.activateCard(id, this.current);
      }
      // Une carte à la fois : l'action s'arrête ici, ses effets (et ses animations) sont validés avant que la carte
      // suivante ne pose ses questions. L'interface relance l'activation pour la carte suivante.
      if (g.phase === "activation" && !E.nextActivation(g)) E.setPhase(g, "action");
      return;
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
      const no = noPlayReason(x.g, a.card);
      if (no) throw new Error(no);
      if (x.p(a.by).cantPlay) throw new Error(x.p(a.by).cantPlay!);
      if (a.target !== a.by) {
        // Poser chez un autre joueur : protections et Piège à Gobelin.
        x.actor = a.by;
        let stop = false;
        try {
          if (x.shielded(a.target, true)) throw new Error(x.reason ?? "Action impossible.");
          stop = x.trapped(a.target);
        } finally {
          x.actor = null;
        }
        if (stop) {
          if (x.g.phase === "action") E.consumeAction(x.g);
          break;
        }
      }
      const from = E.locate(x.g, a.card);
      E.playFromHand(x.room, x.g, a.by, a.card, a.target, a.index, false);
      x.fx({ k: "move", card: a.card });
      x.played(a.card, from);
      x.emit({ type: "placed", uid: a.target, card: a.card, src: null, fromUid: from?.uid, fromZone: from?.zone });
      if (E.locate(x.g, a.card)?.zone === "terrain") x.activateCard(a.card, a.by);
      // La phase 3 n'arrive qu'une fois tous les effets de la pose terminés (effet, passifs, choix).
      if (x.g.phase === "action") E.consumeAction(x.g);
      break;
    }
    case "discard": {
      const at = E.locate(x.g, a.card);
      E.discardFromHand(x.room, x.g, a.by, a.card, false);
      // Cacapulte : la carte peut partir dans la défausse d'un autre joueur.
      const now = E.locate(x.g, a.card);
      if (now?.zone === "discard" && a.card !== "VIC-17" && x.active("VIC-17", now.uid) && x.order.length > 1) {
        const u = x.choosePlayer(now.uid, `Cacapulte : dans quelle défausse envoyer « ${card(a.card).name} » ?`, [now.uid, ...x.others(now.uid)], "VIC-17");
        if (u && u !== now.uid) {
          E.moveCard(x.room, x.g, a.card, { uid: u, zone: "discard" }, true);
          x.take(a.card, u);
          x.log(`💩 Cacapulte : « ${card(a.card).name} » part dans la défausse de ${x.name(u)}.`, { src: "VIC-17", dst: a.card, to: u });
        }
      }
      x.emit({ type: "discard", uid: a.by, card: a.card, src: null });
      if (at) x.emit({ type: "cardMoved", card: a.card, from: at, to: E.locate(x.g, a.card), src: null });
      if (x.g.phase === "action") E.consumeAction(x.g);
      break;
    }
    case "endTurn": {
      const prev = E.hooks.drew;
      E.hooks.drew = (_g, uid, n) => x.emit({ type: "draw", uid, n, from: uid, src: null });
      x.emit({ type: "turnEnd", uid: a.by });
      if (x.g.doubleNow) x.g.doubleNow = null;
      try {
        E.endTurn(x.room, x.g);
      } finally {
        E.hooks.drew = prev;
      }
      if (x.g.double?.includes(x.current)) {
        x.g.double = x.g.double.filter((u) => u !== x.current);
        x.g.doubleNow = x.current;
        x.log(`⛵ Voile : ce tour, chaque carte de ${x.name(x.current)} se joue deux fois.`);
      }
      x.emit({ type: "turnStart", uid: x.current });
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
  const prevLive = E.live.g;
  E.live.g = work;
  try {
    perform(x, act);
    E.hooks.after?.(room, work);
    room.game = work;
  } catch (e) {
    if (!(e instanceof NeedChoice)) throw e;
    base.pending = { action: act, answers, rolls: x.rolls, prompt: e.prompt, trail: x.trail };
    room.game = base;
  } finally {
    E.RNG.next = prev;
    E.live.g = prevLive;
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
  const prevLive = E.live.g;
  E.live.g = g;
  const out: Preview = { ok: true, cards: [], gold: [], sentience: [], bh: [], players: [] };
  const fxStart = g.fxSeq ?? 0;
  try {
    if (at.zone === "hand") E.moveCard(x.room, g, id, { uid: me, zone: "terrain" }, true);
    x.actor = me;
    x.source = id;
    out.ok = s.activate(x, { id, me }) !== false;
  } catch {
    return null;
  } finally {
    E.live.g = prevLive;
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
