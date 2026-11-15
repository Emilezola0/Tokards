// Fléaux — effets automatiques. Les choix d'interprétation sont notés dans la colonne « Précisions » du tableau.
// Restent manuelles (texte à préciser) : Demi Reversi, Agent neurotoxique, Rhume quantique, Aspiration Quazar.
import { card } from "../data/cards";
import * as E from "../game/engine";
import type { BlackHole, Zone } from "../game/types";
import { BLACK_HOLES } from "../game/types";
import type { CardScript, Ctx, Self } from "./runtime";

const P: BlackHole = "Primordial";
const Q: BlackHole = "Quasar";
const B: BlackHole = "Blazard";
const T: BlackHole = "Trou de ver";
const isFleau = (id: string) => card(id).deck === "Fléaux";
const isPassive = (id: string) => card(id).trigger === "Passif";

/** Les champignons poussent l'un après l'autre : chacun place le suivant un tour après avoir été posé. */
const MUSHROOMS = ["FLE-25", "FLE-26", "FLE-27", "FLE-28", "FLE-29"];
function grow(x: Ctx, { id, me }: Self): boolean | void {
  const next = MUSHROOMS[MUSHROOMS.indexOf(id) + 1];
  if (!next) return;
  if ((x.g.born ?? {})[id] === E.pos(x.g)) {
    x.log(`🍄 « ${card(id).name} » vient d'être posée : « ${card(next).name} » poussera au prochain tour.`);
    return;
  }
  const at = E.locate(x.g, next);
  if (at?.zone === "terrain") {
    x.log(`🍄 « ${card(next).name} » a déjà poussé.`);
    return;
  }
  if (!at || (x.g.owner[next] ?? at.uid) !== me) {
    x.reason = `« ${card(next).name} » n'est pas dans tes cartes.`;
    return false;
  }
  const i = x.p(me).terrain.indexOf(id);
  x.move(next, { uid: me, zone: "terrain", index: i + 1 });
  x.log(`🍄 « ${card(id).name} » fait pousser « ${card(next).name} ».`, { src: id, dst: next });
}
const onlyBy = (by: string) => `Ne peut être posée que par « ${card(by).name} ».`;

export const FLEAUX: Record<string, CardScript> = {
  // Courroux d'oré : réagit à chaque changement de son trou noir
  "FLE-01": {
    fixed: true,
    on: {
      blackHole: (x, self, e) => {
        if (e.uid !== self.me) return;
        if (e.to === B) {
          x.triggered(self, "Blazard → −20 gold et passe en Quasar.");
          x.lose(self.me, 20);
          x.setBlackHole(self.me, Q);
        } else if (e.to === Q) {
          x.triggered(self, "Quasar → −30 gold et sentience vraie.");
          x.lose(self.me, 30);
          x.setSentience(self.me, true);
        } else if (e.to === P) {
          x.triggered(self, "Primordial → −50 gold et change le trou noir d'un joueur.");
          x.lose(self.me, 50);
          const t = x.choosePlayer(self.me, "De qui changer le trou noir ?", x.turnOrder(), self.id);
          if (t) x.setBlackHole(t, x.chooseBlackHole(self.me, `Nouveau trou noir de ${x.name(t)}`, x.p(t).blackHole, self.id));
        } else if (e.to === T) {
          x.triggered(self, "Trou de ver → +50 gold et sentience fausse.");
          x.gain(self.me, 50);
          x.setSentience(self.me, false);
        }
      },
    },
  },

  // États d'âmes
  "FLE-02": {
    on: {
      sentience: (x, self, e) => {
        if (e.uid !== self.me) return;
        x.triggered(self, e.v ? "sentience vraie → −10 gold." : "sentience fausse → +20 gold.");
        if (e.v) x.lose(self.me, 10);
        else x.gain(self.me, 20);
      },
    },
  },

  // Malédiction d'unisson : avec la sentience vraie, ses pertes sont subies par tout le monde
  "FLE-03": {
    on: {
      goldLost: (x, self, e) => {
        if (e.uid !== self.me || !x.p(self.me).sentience) return;
        x.triggered(self, `tout le monde perd aussi ${e.amount} gold.`);
        for (const u of x.others(self.me)) x.lose(u, e.amount);
      },
    },
  },

  // Propagation singulière : qui interagit avec le porteur prend son trou noir et la carte
  "FLE-04": {
    on: {
      interaction: (x, self, e) => {
        if (e.target !== self.me || e.actor === self.me || !x.p(e.actor)) return;
        x.triggered(self, `${x.name(e.actor)} a interagi : il prend le trou noir ${x.p(self.me).blackHole} et la carte.`);
        x.setBlackHole(e.actor, x.p(self.me).blackHole);
        x.move(self.id, { uid: e.actor, zone: "terrain" });
        x.take(self.id, e.actor);
      },
    },
  },

  // Reconscience
  "FLE-05": {
    on: {
      goldGained: (x, self, e) => {
        if (e.uid !== self.me || x.p(self.me).sentience) return;
        x.triggered(self, "gain de gold → sentience vraie.");
        x.setSentience(self.me, true);
      },
    },
  },

  // Grippe stellaire
  "FLE-07": {
    on: {
      blackHole: (x, self, e) => {
        if (e.uid !== self.me || e.to !== Q) return;
        x.triggered(self, "Quasar → −20 gold, les autres passent leur sentience à fausse.");
        x.lose(self.me, 20);
        for (const u of x.others(self.me)) x.setSentience(u, false);
      },
    },
  },

  // Trou partagé : suit les changements de trou noir des autres
  "FLE-08": {
    on: {
      blackHole: (x, self, e) => {
        if (e.uid === self.me || x.p(self.me).blackHole === e.to) return;
        x.triggered(self, `${x.name(e.uid)} passe en ${e.to} : ${x.name(self.me)} aussi.`);
        x.setBlackHole(self.me, e.to);
        if (x.confirm(self.me, "Défausser « Trou partagé » ?", self.id)) x.discard(self.id);
      },
    },
  },

  // Tardigrade : chaque perte de gold rejoue la première carte de sa défausse
  "FLE-09": {
    fixed: true,
    on: {
      goldLost: (x, self, e) => {
        if (e.uid !== self.me) return;
        const c = x.p(self.me).discard[0];
        if (!c) return;
        x.triggered(self, `perte de gold → « ${card(c).name} » revient en première position et s'active.`);
        x.move(c, { uid: self.me, zone: "terrain", index: 0 });
        x.activateCard(c, self.me);
      },
    },
  },

  // Fléaux parallèles : géré par le moteur (passifs de la main actifs à 0 gold)
  "FLE-11": {},

  // Déchets toxiques
  "FLE-12": {
    activate: (x, { id, me }) => {
      const justPlaced = x.g.lastPlayed === id && x.g.phase !== "activation";
      if (justPlaced) {
        x.log("☣ Déchets toxiques posés : −10 gold et trou noir au hasard.");
        x.lose(me, 10);
        x.setBlackHole(me, x.random(BLACK_HOLES).id);
      } else {
        x.log("☣ Déchets toxiques déjà sur le terrain : défaussés, +50 gold.");
        x.discard(id);
        x.gain(me, 50);
      }
    },
  },

  // Singularité radioactive (la 2e partie est gérée par le moteur : passifs du dessus de la défausse)
  "FLE-14": {
    on: {
      blackHole: (x, self, e) => {
        if (e.uid !== self.me || e.to !== P) return;
        const first = x.p(self.me).terrain[0];
        if (!first) return;
        x.triggered(self, `Primordial → « ${card(first).name} » est défaussée.`);
        x.discard(first);
      },
    },
  },

  // Maladie draconique : stocke l'or perdu (sentience vraie), le rend quand le porteur tombe à 0
  "FLE-15": {
    on: {
      goldLost: (x, self, e) => {
        if (e.uid !== self.me || !x.p(self.me).sentience) return;
        const store = { ...(x.g.cardStore ?? {}) };
        store[self.id] = (store[self.id] ?? 0) + e.amount;
        x.g.cardStore = store;
        x.triggered(self, `${e.amount} gold stockés (total ${store[self.id]}).`);
      },
      zeroGold: (x, self, e) => {
        const n = x.g.cardStore?.[self.id] ?? 0;
        if (e.uid !== self.me || n <= 0) return;
        x.g.cardStore = { ...(x.g.cardStore ?? {}), [self.id]: 0 };
        x.triggered(self, `0 gold → ${n} gold récupérés.`);
        x.gain(self.me, n);
      },
    },
  },

  // Trou de Gold
  "FLE-16": {
    activate: (x, { me }) => {
      if (!x.p(me).allowNegativeGold) {
        x.p(me).allowNegativeGold = true;
        x.log(`🕳 ${x.name(me)} : ses gold peuvent maintenant être négatifs.`);
      }
    },
    on: {
      sentience: (x, self, e) => {
        const p = x.p(self.me);
        if (e.uid !== self.me || e.v || p.blackHole !== T || p.gold >= 0) return;
        x.triggered(self, `sentience fausse en Trou de ver : ${p.gold} → ${-p.gold} gold.`);
        x.gain(self.me, -2 * p.gold);
      },
    },
  },

  // Contagion biochimique : chaque pioche fait piocher une carte de plus dans la pioche du porteur
  "FLE-17": {
    on: {
      draw: (x, self, e) => {
        if (e.src === self.id) return;
        x.triggered(self, `${x.name(e.uid)} pioche une carte de plus chez ${x.name(self.me)}.`);
        x.draw(e.uid, 1, self.me);
      },
    },
  },

  // Virus subatomique
  "FLE-18": {
    on: {
      draw: (x, self, e) => {
        if (e.uid !== self.me) return;
        x.triggered(self, "pioche → dé trou noir.");
        const v = x.dice(self.me, 4);
        x.setBlackHole(self.me, BLACK_HOLES[v - 1].id);
      },
    },
  },

  // Antidote biomécanique
  "FLE-20": {
    activate: (x, { id, me }) => {
      for (const c of x.allTerrainCards().filter((c) => c !== id && isPassive(c))) x.discard(c);
      x.discard(id);
      x.setBlackHole(me, T);
      x.gain(me, 20);
    },
  },

  // Varicelle cosmique : règle appliquée par le moteur pendant la phase 1
  "FLE-21": {
    activate: (x, { me }) => {
      x.log(x.p(me).sentience
        ? "🦠 Varicelle cosmique : seules les cartes en position impaire se jouent."
        : "🦠 Varicelle cosmique : sentience fausse, aucun effet.");
    },
  },

  // Transmigration de maladie
  "FLE-22": {
    activate: (x, { id, me }) => {
      const zones: Zone[] = ["terrain", "hand", "discard", "deck"];
      const mine = zones.flatMap((z) => x.p(me)[z].filter((c) => c !== id && isFleau(c)));
      if (!mine.length) {
        x.reason = "Aucune autre carte Fléaux à transférer.";
        return false;
      }
      const c = x.chooseCard(me, "Quelle carte Fléaux transférer ?", mine, id);
      const t = x.choosePlayer(me, `À qui transférer « ${c ? card(c).name : ""} » ?`, x.others(me), id);
      if (!c || !t) return false;
      const zone = E.locate(x.g, c)!.zone;
      x.move(c, { uid: t, zone });
      x.take(c, t);
      x.discard(id);
      x.setBlackHole(me, T);
    },
  },

  // Peste épidermique
  "FLE-23": {
    activate: (x, { id }) => {
      const all = x.turnOrder();
      if (!all.every((u) => x.p(u).terrain.length >= 3)) {
        x.reason = "Tous les joueurs n'ont pas au moins 3 cartes sur leur terrain.";
        return false;
      }
      for (const u of all) {
        for (const c of [...x.p(u).terrain, ...x.p(u).hand]) {
          if (c === id) continue;
          x.move(c, { uid: x.g.owner[c] ?? u, zone: "deck" });
        }
      }
      for (const u of all) x.shuffleDeck(u);
      const at = E.locate(x.g, id);
      if (at) x.p(at.uid)[at.zone].splice(at.index, 1);
      x.log("☠ Peste épidermique disparaît de la partie.");
    },
  },

  // Main contagieuse
  "FLE-24": {
    on: {
      discard: (x, self, e) => {
        if (e.src === self.id || !x.p(self.me).hand.length) return;
        x.triggered(self, `${x.name(e.uid)} a défaussé : ${x.name(self.me)} défausse une carte de sa main.`);
        const c = x.chooseCard(self.me, "Quelle carte de ta main défausser ?", x.p(self.me).hand, self.id);
        if (!c) return;
        x.move(c, { uid: x.g.owner[c] ?? self.me, zone: "discard" });
        x.emit({ type: "discard", uid: self.me, card: c, src: self.id });
      },
    },
  },

  // Champignons
  "FLE-25": { activate: grow },
  "FLE-26": { activate: grow, noPlay: onlyBy("FLE-25") },
  "FLE-27": { activate: grow, noPlay: onlyBy("FLE-26") },
  "FLE-28": { activate: grow, noPlay: onlyBy("FLE-27") },
  "FLE-29": { noPlay: onlyBy("FLE-28") },

  // Champignoïte aiguë
  "FLE-30": {
    activate: (x, { me }) => {
      const t = x.p(me).terrain;
      if (!MUSHROOMS.every((m) => t.includes(m))) {
        x.reason = "Les 5 champignons ne sont pas sur ton terrain.";
        return false;
      }
      for (const m of MUSHROOMS.slice(1)) x.discard(m);
      const v = x.chooseOption(me, "Quelle sentience pour tout le monde ?", ["Vraie", "Fausse"]) === 0;
      for (const u of x.turnOrder()) {
        x.setBlackHole(u, T);
        x.setSentience(u, v);
      }
      x.gain(me, 100);
      const d = x.chooseCards(me, "Défausser une carte de ta main ? (facultatif)", x.p(me).hand, 0, 1);
      for (const c of d) x.move(c, { uid: x.g.owner[c] ?? me, zone: "discard" });
    },
  },

  // Docteur malade
  "FLE-31": {
    on: {
      zeroGold: (x, self, e) => {
        const c = x.p(self.me).deck[0];
        if (!c) return;
        x.triggered(self, `${x.name(e.uid)} tombe à 0 gold : « ${card(c).name} » est posée sur son terrain et s'active.`);
        x.move(c, { uid: e.uid, zone: "terrain" });
        x.activateCard(c, e.uid);
      },
    },
  },

  // Défaite victorieuse : gérée par la vérification des conditions
  "FLE-32": {},
};

// Garde-fou : si le tableau est réorganisé, on le signale au lieu d'appliquer le mauvais effet.
const EXPECTED: Record<string, string> = {
  "FLE-01": "Couroux d'oré", "FLE-09": "Tardigrade", "FLE-17": "Contagion Biochimique", "FLE-25": "Agaric", "FLE-32": "Défaite Victorieuse",
};
for (const [id, n] of Object.entries(EXPECTED)) {
  if (card(id).name !== n) console.warn(`Tokards : ${id} devrait être « ${n} », trouvé « ${card(id).name} ».`);
}
