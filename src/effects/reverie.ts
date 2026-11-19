// Rêverie — effets automatiques. Le Rêveur fait alterner la sentience ; les Rêves récompensent, les Cauchemars punissent.
// Les choix d'interprétation sont notés dans l'onglet « Interprétations » du tableau.
import { card } from "../data/cards";
import * as E from "../game/engine";
import { BLACK_HOLES, BH_SYMBOL, type BlackHole } from "../game/types";
import type { CardScript, Ctx, Self } from "./runtime";

const REVEUR = "REV-01";
const DREAMS = ["REV-07", "REV-08", "REV-09", "REV-10", "REV-11", "REV-12", "REV-13", "REV-14"];
const NIGHTMARES = ["REV-15", "REV-16", "REV-17", "REV-18", "REV-19"];
const isDream = (id: string) => DREAMS.includes(id);
const isNightmare = (id: string) => NIGHTMARES.includes(id);
/** Cycle du trou noir (ordre du dé trou noir). */
const CYCLE: BlackHole[] = BLACK_HOLES.map((b) => b.id);

const mark = (x: Ctx, id: string) => x.g.marks?.[id];
function setMark(x: Ctx, id: string, v: string | null) {
  const m = { ...(x.g.marks ?? {}) };
  if (v === null) delete m[id];
  else m[id] = v;
  x.g.marks = m;
}
const store = (x: Ctx, id: string) => x.g.cardStore?.[id] ?? 0;
function setStore(x: Ctx, id: string, n: number) {
  const s = { ...(x.g.cardStore ?? {}) };
  if (n) s[id] = n;
  else delete s[id];
  x.g.cardStore = s;
}
/** Protection d'un tour (Rêve d'amitié, Cauchemar d'emprisonnement) : `by` ne peut pas toucher `prot` (« * » = personne). */
function shield(x: Ctx, by: string, prot: string) {
  x.g.shields = [...(x.g.shields ?? []).filter((s) => !(s.by === by && s.prot === prot)), { by, prot, after: E.pos(x.g) }];
}

/** Pose le Rêveur (où qu'il soit) sur le terrain de `me`, à la place `index`, sans effet. */
function bringDreamer(x: Ctx, me: string, index: number): boolean {
  const at = E.locate(x.g, REVEUR);
  if (!at) {
    x.reason = "Le Rêveur n'est plus en jeu.";
    return false;
  }
  if (at.zone === "terrain" && at.uid === me) {
    x.reason = "Le Rêveur est déjà sur ton terrain.";
    return false;
  }
  if (!x.move(REVEUR, { uid: me, zone: "terrain", index }, { activate: false })) return false;
  x.take(REVEUR, me);
  return true;
}

/** « Vous pouvez défausser cette carte pour poser un Rêveur » : proposé quand le Rêve se joue sur ton terrain et que le Rêveur n'y est pas. */
function offerDreamer(x: Ctx, self: Self) {
  const at = E.locate(x.g, self.id);
  if (at?.zone !== "terrain" || at.uid !== self.me) return;
  const r = E.locate(x.g, REVEUR);
  if (!r || (r.zone === "terrain" && r.uid === self.me)) return;
  const o = x.chooseOption(self.me, `Défausser « ${card(self.id).name} » pour poser le Rêveur à sa place ?`, ["Garder le rêve", "Poser le Rêveur"], self.id);
  if (o === 0) return;
  x.discard(self.id);
  if (E.locate(x.g, self.id)?.zone === "terrain") return;
  if (bringDreamer(x, self.me, at.index)) x.log(`💤 Le Rêveur prend la place de « ${card(self.id).name} ».`, { dst: REVEUR });
}

/** Effet des Rêves passifs selon la sentience (true = elle vient de passer à vraie). */
const DREAM_FX: Record<string, (x: Ctx, self: Self, v: boolean) => void> = {
  // Rêve de voyage : échange 2 cartes des terrains
  "REV-07": (x, self, v) => {
    if (!v) return;
    const pool = x.allTerrainCards();
    if (pool.length < 2) return x.log("Rêve de voyage : pas assez de cartes sur les terrains.");
    const two = x.chooseCards(self.me, "Rêve de voyage : quelles 2 cartes des terrains échanger ?", pool, 2, 2, self.id);
    if (two.length === 2) x.swap(two[0], two[1]);
  },
  // Rêve de fortune : 50 gold (vraie) ou 2 gold (fausse)
  "REV-08": (x, self, v) => void x.gain(self.me, v ? 50 : 2),
  // Rêve de connaissances : une pose de plus ce tour (vraie) ou pioche 1 carte (fausse)
  "REV-09": (x, self, v) => {
    if (!v) return void x.draw(self.me, 1);
    if (self.me !== x.current) return x.log("Rêve de connaissances : ce n'est pas ton tour, pas de pose en plus.");
    if (x.g.phase === "end") E.grantExtraAction(x.room, x.g);
    else x.g.actionsLeft += 1;
    x.log(`📚 ${x.name(self.me)} peut poser une carte de plus ce tour.`);
  },
};

/** Rêve passif : réagit quand la sentience de son joueur change ; à son tour, propose seulement le Rêveur. */
function passiveDream(id: string): CardScript {
  return {
    on: {
      sentience: (x, self, e) => {
        if (e.uid !== self.me || (id === "REV-07" && !e.v)) return;
        x.triggered(self, `ta sentience passe à ${e.v ? "vraie" : "fausse"}.`);
        DREAM_FX[id](x, self, e.v);
      },
    },
    activate: (x, self) => offerDreamer(x, self),
  };
}

/** Rêve à activer : effet si la sentience est vraie, puis proposition du Rêveur. */
function activeDream(effect: (x: Ctx, self: Self) => boolean | void): CardScript {
  return {
    activate: (x, self) => {
      let res: boolean | void = undefined;
      if (x.p(self.me).sentience) res = effect(x, self);
      else {
        x.reason = "Ta sentience est fausse.";
        res = false;
      }
      offerDreamer(x, self);
      return res;
    },
  };
}

/** Cauchemars : cible un autre joueur dont la sentience est vraie. */
function nightmareTarget(x: Ctx, me: string, id: string, what: string): string | null {
  const u = x.choosePlayer(me, `${card(id).name} : ${what}`, x.others(me).filter((u) => x.p(u).sentience), id);
  if (!u) x.reason = "Aucun autre joueur n'a la sentience vraie.";
  return u;
}

/** Joue un Rêve trouvé hors du terrain (Attrape-rêves) pour `me`. */
function playDream(x: Ctx, c: string, me: string) {
  if (DREAM_FX[c]) {
    x.log(`✨ « ${card(c).name} » joue son effet pour ${x.name(me)}.`, { dst: c });
    x.runAs(c, me, () => DREAM_FX[c](x, { id: c, me }, x.p(me).sentience));
  } else x.activateCard(c, me);
}

export const REVERIE: Record<string, CardScript> = {
  // Rêveur (passif) : tous les 3 de tes tours, sentience vraie jusqu'à la fin du tour ; sentience fausse → recule d'une place
  // au début de ton tour ; les changements de sentience venant des autres joueurs ne te touchent pas (voir runtime).
  "REV-01": {
    on: {
      turnStart: (x, self, e) => {
        if (e.uid !== self.me) return;
        const n = store(x, self.id) + 1;
        setStore(x, self.id, n % 3);
        if (n % 3 === 0) {
          x.triggered(self, "3e tour : tu rêves, ta sentience passe à vraie jusqu'à la fin du tour.");
          setMark(x, self.id, "rêve");
          x.setSentience(self.me, true);
          return;
        }
        x.log(`💤 Rêveur : prochain rêve dans ${3 - (n % 3)} tour(s).`, { src: self.id });
        const at = E.locate(x.g, self.id);
        if (!x.p(self.me).sentience && at?.zone === "terrain" && at.index > 0) {
          x.triggered(self, "ta sentience est fausse : il recule d'une place.");
          x.move(self.id, { uid: at.uid, zone: "terrain", index: at.index - 1 });
        }
      },
      turnEnd: (x, self, e) => {
        if (e.uid !== self.me || mark(x, self.id) !== "rêve") return;
        setMark(x, self.id, null);
        x.triggered(self, "fin du rêve : ta sentience passe à fausse.");
        x.setSentience(self.me, false);
      },
    },
  },

  // Lit : sans Rêveur sur ton terrain, il vient en première place ; sinon prends une carte 🌀 de ta pioche ou défausse
  "REV-02": {
    activate: (x, { id, me }) => {
      const r = E.locate(x.g, REVEUR);
      if (!(r?.zone === "terrain" && r.uid === me)) {
        if (!bringDreamer(x, me, 0)) return false;
        x.log("🛏 Le Rêveur est posé en première place.", { dst: REVEUR });
        return;
      }
      const p = x.p(me);
      const pool = [...p.deck, ...p.discard].filter((c) => E.tagsOf(x.g, c).blackHole);
      const c = x.chooseCard(me, "Lit : quelle carte 🌀 de ta pioche ou de ta défausse prendre en main ?", pool, id);
      if (!c) {
        x.reason = "Aucune carte 🌀 dans ta pioche ni ta défausse.";
        return false;
      }
      const from = E.locate(x.g, c)?.zone;
      x.move(c, { uid: me, zone: "hand" });
      if (from === "deck") x.shuffleZone(me, "deck");
    },
  },

  // Attrape-rêves : tu peux révéler les 3 premières cartes de ta pioche ; un Rêve parmi elles joue son effet puis est défaussé
  "REV-03": {
    activate: (x, { id, me }) => {
      const top = x.p(me).deck.slice(0, 3);
      if (!top.length) {
        x.reason = "Ta pioche est vide.";
        return false;
      }
      if (x.chooseOption(me, "Attrape-rêves : révéler les 3 premières cartes de ta pioche ?", ["Révéler", "Ne rien faire"], id) === 1) return x.log("Attrape-rêves : rien.");
      x.log(`🕸 ${x.name(me)} révèle : ${top.map((c) => `« ${card(c).name} »`).join(", ")}.`);
      x.chooseCards(me, "Attrape-rêves : cartes révélées (valide pour continuer).", top, 0, 0, id);
      const dreams = top.filter(isDream);
      if (!dreams.length) {
        x.reason = "Aucun Rêve parmi les cartes révélées.";
        return false;
      }
      const c = x.chooseCard(me, "Quel Rêve attraper ?", dreams, id)!;
      playDream(x, c, me);
      if (E.locate(x.g, c)?.zone === "deck") x.move(c, { uid: E.locate(x.g, c)!.uid, zone: "discard" });
    },
  },

  // Sommeil : cible un autre joueur ; si sa sentience est fausse, désactive une carte d'un terrain (1 tour) ; puis sa sentience → vraie
  "REV-04": {
    activate: (x, { id, me }) => {
      const u = x.choosePlayer(me, "Sommeil : quel joueur endormir ?", x.others(me), id);
      if (!u) return false;
      if (!x.p(u).sentience) {
        const c = x.chooseCard(me, `${x.name(u)} est éveillé : quelle carte d'un terrain désactiver (1 tour) ?`, x.allTerrainCards().filter((c) => !x.isDisabled(c)), id);
        if (c) x.disable(c, x.untilStartOfNext(me));
      }
      x.setSentience(u, true);
    },
  },

  // Réveil : la sentience d'un joueur passe à fausse
  "REV-05": {
    activate: (x, { id, me }) => {
      const u = x.choosePlayer(me, "Réveil : quel joueur réveiller ?", x.turnOrder().filter((u) => x.p(u).sentience), id);
      if (!u) {
        x.reason = "Personne n'a la sentience vraie.";
        return false;
      }
      x.setSentience(u, false);
    },
  },

  // Souvenir : les 3 cartes du dessus de ta défausse ; avec un Rêve et un Cauchemar : une posée, une dans la pioche, une en main
  "REV-06": {
    activate: (x, { id, me }) => {
      const top = x.p(me).discard.slice(0, 3);
      if (top.length) x.log(`📜 Souvenir révèle : ${top.map((c) => `« ${card(c).name} »`).join(", ")}.`);
      if (!top.some(isDream) || !top.some(isNightmare)) {
        x.reason = "Il faut au moins un Rêve et un Cauchemar parmi les 3 cartes du dessus de ta défausse.";
        return false;
      }
      let rest = [...top];
      const pose = x.chooseCard(me, "Souvenir : quelle carte poser sur ton terrain ?", rest, id)!;
      rest = rest.filter((c) => c !== pose);
      const mix = rest.length > 1 ? x.chooseCard(me, "Quelle carte mélanger dans ta pioche ? (l'autre va dans ta main)", rest, id)! : rest[0];
      rest = rest.filter((c) => c !== mix);
      const slot = x.chooseSlot(me, `Où poser « ${card(pose).name} » ?`, me, pose, id);
      x.move(pose, { uid: me, zone: "terrain", index: slot });
      if (mix && x.move(mix, { uid: me, zone: "deck" })) x.shuffleZone(me, "deck");
      for (const c of rest) x.move(c, { uid: me, zone: "hand" });
    },
  },

  "REV-07": passiveDream("REV-07"),
  "REV-08": passiveDream("REV-08"),
  "REV-09": passiveDream("REV-09"),

  // Rêve d'amitié : à son prochain tour, le joueur ciblé ne peut pas te nuire
  "REV-10": activeDream((x, { id, me }) => {
    const u = x.choosePlayer(me, "Rêve d'amitié : quel joueur ne pourra pas te nuire à son prochain tour ?", x.others(me), id);
    if (!u) return false;
    shield(x, u, me);
    x.log(`🤝 ${x.name(u)} ne pourra pas nuire à ${x.name(me)} pendant son prochain tour.`, { to: u });
    x.interact(u, "rêve");
  }),

  // Rêve d'une autre vie : défausse et main mélangées dans la pioche, puis pioche 4 cartes
  "REV-11": activeDream((x, { me }) => {
    const p = x.p(me);
    const n = p.hand.length;
    p.deck.push(...p.hand);
    p.hand = [];
    x.shuffleDeck(me, true);
    x.log(`🌀 ${x.name(me)} remet sa main (${n} carte(s)) et sa défausse dans sa pioche.`);
    x.draw(me, 4);
  }),

  // Rêve prophétique : regarde la main d'un joueur (vraie) — la sentience fausse ne laisse voir qu'une carte (voir activeDream)
  "REV-12": {
    activate: (x, self) => {
      const { id, me } = self;
      const u = x.choosePlayer(me, "Rêve prophétique : quelle main regarder ?", x.others(me).filter((u) => x.p(u).hand.length), id);
      if (!u) {
        x.reason = "Aucun autre joueur n'a de carte en main.";
        offerDreamer(x, self);
        return false;
      }
      if (x.p(me).sentience) {
        x.chooseCards(me, `🔮 Main de ${x.name(u)} (valide pour continuer).`, x.p(u).hand, 0, 0, id);
        x.log(`🔮 ${x.name(me)} regarde la main de ${x.name(u)}.`, { to: u });
      } else {
        const c = x.chooseCard(me, `Choisis une carte (face cachée) de la main de ${x.name(u)} à regarder.`, x.p(u).hand, id, true)!;
        x.chooseCards(me, `🔮 Carte de ${x.name(u)} (valide pour continuer).`, [c], 0, 0, id);
        x.log(`🔮 ${x.name(me)} regarde une carte de la main de ${x.name(u)}.`, { to: u });
      }
      x.interact(u, "main");
      offerDreamer(x, self);
    },
  },

  // Rêve de renaissance : pose une carte de ta défausse
  "REV-13": activeDream((x, { id, me }) => {
    const c = x.chooseCard(me, "Rêve de renaissance : quelle carte de ta défausse poser ?", x.p(me).discard, id);
    if (!c) {
      x.reason = "Ta défausse est vide.";
      return false;
    }
    const slot = x.chooseSlot(me, `Où poser « ${card(c).name} » ?`, me, c, id);
    return x.move(c, { uid: me, zone: "terrain", index: slot });
  }),

  // Rêve de pouvoir : ton trou noir prend l'état choisi, puis l'effet de cet état
  "REV-14": activeDream((x, { id, me }) => {
    const labels: Record<BlackHole, string> = {
      Primordial: "la sentience d'un joueur passe à vraie",
      Blazard: "change le trou noir d'un joueur",
      Quasar: "échange la place de 2 de tes cartes",
      "Trou de ver": "gagne 10 gold",
    };
    const b = CYCLE[x.chooseOption(me, "Rêve de pouvoir : quel état choisir ?", CYCLE.map((b) => `${BH_SYMBOL[b]} ${b} : ${labels[b]}`), id)];
    x.setBlackHole(me, b);
    if (b === "Primordial") {
      const u = x.choosePlayer(me, "Sentience de qui passe à vraie ?", x.turnOrder(), id);
      if (u) x.setSentience(u, true);
    } else if (b === "Blazard") {
      const u = x.choosePlayer(me, "Trou noir de qui changer ?", x.turnOrder(), id);
      if (u) x.setBlackHole(u, x.chooseBlackHole(me, `Nouveau trou noir de ${x.name(u)} ?`, x.p(u).blackHole, id));
    } else if (b === "Quasar") {
      const t = x.p(me).terrain;
      if (t.length < 2) return x.log("Rêve de pouvoir : moins de 2 cartes sur ton terrain.");
      const two = x.chooseCards(me, "Quelles 2 cartes de ton terrain échanger ?", t, 2, 2, id);
      if (two.length === 2) x.swap(two[0], two[1]);
    } else x.gain(me, 10);
  }),

  // Cauchemar de destruction : défausse une carte du terrain d'un joueur à sentience vraie
  "REV-15": {
    activate: (x, { id, me }) => {
      const u = nightmareTarget(x, me, id, "quel joueur cibler ?");
      if (!u) return false;
      const c = x.chooseCard(me, `Quelle carte du terrain de ${x.name(u)} défausser ?`, x.p(u).terrain, id);
      if (!c) {
        x.reason = `${x.name(u)} n'a aucune carte sur son terrain.`;
        return false;
      }
      x.discard(c);
    },
  },

  // Cauchemar de l'oubli : effet selon ton trou noir sur un joueur à sentience vraie ; sentience fausse → ton trou noir avance d'un cran
  "REV-16": {
    activate: (x, { id, me }) => {
      const u = nightmareTarget(x, me, id, "quel joueur cibler ?");
      let ok = !!u;
      if (u) {
        const b = x.p(me).blackHole;
        if (b === "Primordial") x.lose(u, 5);
        else if (b === "Blazard") {
          const c = x.p(u).deck[0];
          if (c) x.move(c, { uid: u, zone: "discard" });
          else x.log(`La pioche de ${x.name(u)} est vide.`);
        } else if (b === "Quasar") {
          const c = x.chooseCard(me, `Quelle carte (face cachée) de la main de ${x.name(u)} défausser ?`, x.p(u).hand, id, true);
          if (c) x.move(c, { uid: u, zone: "discard" });
          else x.log(`${x.name(u)} n'a pas de carte en main.`);
        } else {
          x.log("🕳 Trou de ver : le cauchemar se détruit.");
          x.discard(id);
        }
      }
      if (!x.p(me).sentience) {
        x.log("Ta sentience est fausse : ton trou noir avance d'un cran.");
        x.cycleBlackHole(me, CYCLE);
        ok = true;
      }
      return ok;
    },
  },

  // Cauchemar d'emprisonnement : à son prochain tour, le joueur ciblé ne peut pas interagir avec les autres
  "REV-17": {
    activate: (x, { id, me }) => {
      const u = nightmareTarget(x, me, id, "quel joueur emprisonner ?");
      if (!u) return false;
      shield(x, u, "*");
      x.log(`⛓ ${x.name(u)} ne pourra interagir avec personne pendant son prochain tour.`, { to: u });
      x.interact(u, "cauchemar");
    },
  },

  // Cauchemar de poursuite (une seule fois) : posé à la fin du terrain d'un joueur à sentience vraie ; à chaque tour de ce
  // joueur, il recule d'une place et lui fait perdre 2 gold ; en première place, tout le terrain est défaussé.
  "REV-18": {
    activate: (x, { id, me }) => {
      const at = E.locate(x.g, id)!;
      const state = mark(x, id);
      if (state?.startsWith("chase:") && at.zone === "terrain" && at.uid === state.slice(6)) {
        const v = at.uid;
        if (at.index > 0) x.move(id, { uid: v, zone: "terrain", index: at.index - 1 });
        x.lose(v, 2);
        if (E.locate(x.g, id)?.index === 0) {
          x.log(`👹 Le cauchemar rattrape ${x.name(v)} : tout son terrain est défaussé.`, { to: v });
          for (const c of [...x.p(v).terrain]) x.discard(c);
          setMark(x, id, "done");
        }
        return;
      }
      if (state) {
        x.reason = "L'effet n'est utilisable qu'une seule fois.";
        return false;
      }
      const u = nightmareTarget(x, me, id, "quel joueur poursuivre ?");
      if (!u) return false;
      if (!x.move(id, { uid: u, zone: "terrain" }, { activate: false })) return false;
      setMark(x, id, `chase:${u}`);
      x.log(`👹 Le cauchemar se lance à la poursuite de ${x.name(u)}.`, { to: u });
    },
  },

  // Cauchemar de pauvreté : un joueur à sentience vraie perd 10 gold
  "REV-19": {
    activate: (x, { id, me }) => {
      const u = nightmareTarget(x, me, id, "quel joueur appauvrir ?");
      if (!u) return false;
      x.lose(u, 10);
    },
  },

  // ✨ Ajoutée par Claude (v0.23) — Marchand de sable : pour 20 gold (facultatif), la sentience d'un joueur → vraie
  "REV-20": {
    activate: (x, { id, me }) => {
      if (!x.canPay(me, 20)) return false;
      const pool = x.turnOrder().filter((u) => !x.p(u).sentience);
      if (!pool.length) {
        x.reason = "Tout le monde a déjà la sentience vraie.";
        return false;
      }
      const [u] = x.chooseCards(me, "Marchand de sable : endormir quel joueur pour 20 gold ? (sa 🧠 → vraie, facultatif)", pool, 0, 1, id);
      if (!u) return x.log("Marchand de sable : personne n'est endormi.");
      if (!x.spend(me, 20)) return false;
      x.setSentience(u, true);
    },
  },

  // ✨ Ajoutée par Claude (v0.23) — Insomnie : sentience fausse → tu peux échanger tes gold avec un joueur à sentience vraie
  "REV-21": {
    activate: (x, { id, me }) => {
      if (x.p(me).sentience) {
        x.reason = "Ta sentience est vraie : tu dors, pas d'insomnie.";
        return false;
      }
      const pool = x.others(me).filter((u) => x.p(u).sentience);
      if (!pool.length) {
        x.reason = "Aucun autre joueur n'a la sentience vraie.";
        return false;
      }
      const [u] = x.chooseCards(me, "Insomnie : échanger tes gold avec quel joueur ? (facultatif)", pool, 0, 1, id);
      if (!u) return x.log("Insomnie : pas d'échange.");
      x.swapGold(me, u);
    },
  },

  // ✨ Ajoutée par Claude (v0.23) — Somnambule : choisis ton trou noir
  "REV-22": {
    activate: (x, { id, me }) => {
      x.setBlackHole(me, x.chooseBlackHole(me, "Somnambule : ton nouveau trou noir ?", x.p(me).blackHole, id));
    },
  },
};
