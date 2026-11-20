// Dynastie des Grenouilles — effets automatiques. Le hasard décide de beaucoup de choses :
// « ciblez un joueur aléatoirement » tire la cible au hasard et l'annonce dans le journal.
// Les choix d'interprétation sont notés dans la colonne « Précisions » du tableau.
import { card } from "../data/cards";
import * as E from "../game/engine";
import type { BlackHole } from "../game/types";
import type { CardScript, Ctx } from "./runtime";

const P: BlackHole = "Primordial";
const Q: BlackHole = "Quasar";
const B: BlackHole = "Blazard";
const T: BlackHole = "Trou de ver";
const isBH = (id: string) => E.tagsOf(E.live.g, id).blackHole;

const last = <T,>(a: T[]) => a[a.length - 1];

/** Jet de dé de sentience : la sentience du joueur devient le résultat. */
function rollSentience(x: Ctx, uid: string) {
  x.setSentience(uid, x.sentDice(uid));
}
/** Jet de dé trou noir : le trou noir du joueur devient le résultat. */
function rollBlackHole(x: Ctx, uid: string) {
  x.setBlackHole(uid, x.bhDice(uid));
}

export const GRENOUILLES: Record<string, CardScript> = {
  // Grenouille-Requin : pioche une carte, la pose en dernier et active son effet
  "GRE-01": {
    activate: (x, { me }) => {
      const before = new Set(x.p(me).hand);
      if (!x.draw(me, 1)) {
        x.reason = "Ta pioche est vide.";
        return false;
      }
      const c = x.p(me).hand.find((id) => !before.has(id))!;
      x.move(c, { uid: me, zone: "terrain" }, { activate: me });
    },
  },

  // Date de grenouille : cible au hasard (toi compris), défausse sa dernière carte, puis défausse cette carte
  "GRE-02": {
    activate: (x, { id, me }) => {
      const u = x.randomPlayer(x.turnOrder());
      if (!u) return false;
      const c = last(x.p(u).terrain);
      if (c) x.discard(c);
      else x.log(`${x.name(u)} n'a aucune carte sur son terrain.`);
      if (E.locate(x.g, id)?.zone === "terrain") x.discard(id);
    },
  },

  // Trône d'amphibiens : la cible au hasard gagne 1d100 gold
  "GRE-03": {
    activate: (x) => {
      const u = x.randomPlayer(x.turnOrder());
      if (!u) return false;
      x.gain(u, x.dice(u, 100));
    },
  },

  // Marécage spatial : dé trou noir
  "GRE-04": { activate: (x, { me }) => rollBlackHole(x, me) },

  // Rainette : dé de sentience
  "GRE-05": { activate: (x, { me }) => rollSentience(x, me) },

  // Crapaud virulent : la cible au hasard perd 1d20 gold
  "GRE-06": {
    activate: (x) => {
      const u = x.randomPlayer(x.turnOrder());
      if (!u) return false;
      x.lose(u, x.dice(u, 20));
    },
  },

  // Crapaud conquérant : vole la première carte du terrain d'un adversaire au hasard et la met sur ta pioche
  "GRE-07": {
    activate: (x, { me }) => {
      const u = x.randomPlayer(x.others(me));
      if (!u) return false;
      const c = x.p(u).terrain[0];
      if (!c) {
        x.reason = `${x.name(u)} n'a aucune carte sur son terrain.`;
        return false;
      }
      if (!x.move(c, { uid: me, zone: "deck", bottom: true })) return false;
      x.take(c, me);
    },
  },

  // Rainette Roulette : une chance sur trois pour chaque effet
  "GRE-08": {
    activate: (x, { me }) => {
      const v = x.dice(me, 3);
      if (v === 1) x.gain(me, 10);
      else if (v === 2) x.setBlackHole(me, B);
      else x.setSentience(me, true);
    },
  },

  // Chevalier Crapaud : joue l'effet d'une autre carte de ton terrain tirée au hasard
  "GRE-09": {
    activate: (x, { id, me }) => {
      const pool = x.p(me).terrain.filter((c) => c !== id);
      if (!pool.length) {
        x.reason = "Aucune autre carte sur ton terrain.";
        return false;
      }
      const c = x.random(pool);
      x.log(`🎯 Carte tirée au hasard : « ${card(c).name} ».`, { dst: c });
      if (!x.canActivate(c) || x.isDisabled(c)) {
        x.reason = `« ${card(c).name} » ne peut pas jouer d'effet.`;
        return false;
      }
      x.activateCard(c, me);
    },
  },

  // Amphibien Pilote : échange ta première carte 🌀 avec celle d'une cible au hasard (toi compris)
  "GRE-10": {
    activate: (x, { me }) => {
      const u = x.randomPlayer(x.turnOrder());
      if (!u) return false;
      if (u === me) {
        x.log("La cible est le lanceur : il n'y a rien à échanger.");
        return;
      }
      const mine = x.p(me).terrain.find(isBH);
      const theirs = x.p(u).terrain.find(isBH);
      if (!mine || !theirs) {
        x.reason = !mine ? "Aucune carte 🌀 sur ton terrain." : `${x.name(u)} n'a aucune carte 🌀 sur son terrain.`;
        return false;
      }
      x.swap(mine, theirs);
    },
  },

  // Crapaud boxeur : défausse le dessus de ta pioche, puis prends la carte du fond de ta défausse
  "GRE-11": {
    activate: (x, { me }) => {
      const top = x.p(me).deck[0];
      if (top) x.discard(top);
      const bottom = last(x.p(me).discard);
      if (!bottom) {
        x.reason = "Ta défausse est vide.";
        return false;
      }
      x.move(bottom, { uid: me, zone: "hand" });
    },
  },

  // Aspirant chevalier Crapaud : +20 par autre joueur sentient, −20 par autre joueur non sentient
  "GRE-12": {
    activate: (x, { me }) => {
      const others = x.others(me);
      const yes = others.filter((u) => x.p(u).sentience).length;
      const no = others.length - yes;
      x.log(`${yes} joueur(s) sentient(s), ${no} non sentient(s).`);
      if (yes) x.gain(me, 20 * yes);
      if (no) x.lose(me, 20 * no);
    },
  },

  // Grenouille Corp CEO : table du d100
  "GRE-13": {
    activate: (x, { id, me }) => {
      const v = x.dice(me, 100);
      if (v <= 10) x.lose(me, 10);
      else if (v <= 20) x.gain(me, 10);
      else if (v <= 30) x.setBlackHole(me, Q);
      else if (v <= 40) x.setBlackHole(me, B);
      else if (v <= 50) x.setBlackHole(me, P);
      else if (v <= 60) x.setBlackHole(me, T);
      else if (v <= 70) x.setSentience(me, true);
      else if (v <= 80) x.setSentience(me, false);
      else x.discard(id);
    },
  },

  // Rainette Chômeuse : dépense 10 gold, Trou de ver, sentience fausse, puis 1d4 : sur 4 elle se défausse
  "GRE-14": {
    activate: (x, { id, me }) => {
      if (!x.spend(me, 10)) return false;
      x.setBlackHole(me, T);
      x.setSentience(me, false);
      if (x.dice(me, 4) === 4) x.discard(id);
    },
  },

  // Grenouille Rainette : +50 gold si personne d'autre n'a ton trou noir
  "GRE-15": {
    activate: (x, { me }) => {
      const bh = x.p(me).blackHole;
      if (x.others(me).some((u) => x.p(u).blackHole === bh)) {
        x.reason = `Un autre joueur est aussi en ${bh}.`;
        return false;
      }
      x.gain(me, 50);
    },
  },

  // Aspirant Crapaud conquérant : le dessus de la pioche d'une cible au hasard va dans sa défausse
  "GRE-16": {
    activate: (x) => {
      const u = x.randomPlayer(x.turnOrder());
      if (!u) return false;
      const top = x.p(u).deck[0];
      if (!top) {
        x.reason = `La pioche de ${x.name(u)} est vide.`;
        return false;
      }
      x.discard(top);
    },
  },

  // Rainette des pluies : sentience vraie → les autres perdent 10 gold, tu en gagnes 10
  "GRE-17": {
    activate: (x, { me }) => {
      if (!x.p(me).sentience) {
        x.reason = "Ta sentience est fausse.";
        return false;
      }
      for (const u of x.others(me)) x.lose(u, 10);
      x.gain(me, 10);
    },
  },

  // Lemon Juice : une carte de la main de la cible (face cachée) va dans sa défausse, puis Lemon Juice
  // échange sa place avec la carte du fond de ta défausse
  "GRE-18": {
    activate: (x, { id, me }) => {
      const pool = x.others(me).filter((u) => x.p(u).hand.length);
      const u = x.choosePlayer(me, "Lemon Juice : quelle cible ?", pool, id);
      if (!u) {
        x.reason = "Aucun adversaire n'a de carte en main.";
        return false;
      }
      const c = x.chooseCard(me, `Choisis une carte (face cachée) de la main de ${x.name(u)}.`, x.p(u).hand, id, true);
      if (c) x.discard(c);
      const bottom = last(x.p(me).discard);
      if (bottom && E.locate(x.g, id)?.zone === "terrain") x.swap(id, bottom);
    },
  },

  // Grenouille tampon (passif) : géré par le moteur, elle part à la place des autres cartes de son terrain.
  "GRE-19": {},

  // Rainette des lacs : sentience fausse → les autres gagnent 10 gold et ta sentience passe à vraie
  "GRE-20": {
    activate: (x, { me }) => {
      if (x.p(me).sentience) {
        x.reason = "Ta sentience est déjà vraie.";
        return false;
      }
      for (const u of x.others(me)) x.gain(u, 10);
      x.setSentience(me, true);
    },
  },

  // Crapaud stratège : se place sous une carte de n'importe quel terrain ; les choix de cette carte se font au hasard
  "GRE-21": {
    activate: (x, { id, me }) => {
      const pool = x.allTerrainCards().filter((c) => c !== id);
      const host = x.chooseCard(me, "Sous quelle carte placer le Crapaud stratège ?", pool, id);
      if (!host) {
        x.reason = "Aucune autre carte sur les terrains.";
        return false;
      }
      x.putUnder(id, host);
      // Nouveau support : le vrai lanceur garde la main jusqu'au prochain début de tour.
      if (x.g.marks?.["GRE-21"]) {
        const m = { ...x.g.marks };
        delete m["GRE-21"];
        x.g.marks = m;
      }
      x.log(`🐸 Crapaud stratège se place sous « ${card(host).name} » : ses choix se feront au hasard.`, { dst: host });
    },
  },

  // Pèlerinage amphibien : sentience vraie → dé trou noir ; fausse → dé de sentience
  "GRE-22": {
    activate: (x, { me }) => {
      if (x.p(me).sentience) rollBlackHole(x, me);
      else rollSentience(x, me);
    },
  },

  // Crapaud motard (passif) : quand il est posé ou se déplace, les joueurs concernés lancent le dé trou noir
  "GRE-23": {
    onMove: (x, self, from, to) => {
      if (to?.zone !== "terrain") return;
      if (from?.zone === "terrain" && from.uid === to.uid && from.index === to.index) return;
      const who = [...new Set([from?.uid, to.uid].filter((u): u is string => !!u && !!x.p(u)))];
      x.triggered(self, `il ${from?.zone === "terrain" ? "se déplace" : "est posé"} : ${who.map((u) => x.name(u)).join(" et ")} lance${who.length > 1 ? "nt" : ""} le dé trou noir.`);
      for (const u of who) rollBlackHole(x, u);
    },
  },

  // Rainette spéculative (passif) : géré par le moteur (un vol de gold devient un d100).
  "GRE-24": {},
};
