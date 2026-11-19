// Empire Goblin — effets automatiques. Les choix d'interprétation sont notés dans
// la colonne « Précisions » du tableau des cartes.
import { card } from "../data/cards";
import * as E from "../game/engine";
import type { BlackHole } from "../game/types";
import type { CardScript, Ctx } from "./runtime";

const P: BlackHole = "Primordial";
const Q: BlackHole = "Quasar";
const B: BlackHole = "Blazard";
const T: BlackHole = "Trou de ver";

const tags = (id: string) => E.tagsOf(E.live.g, id);
const isGold = (id: string) => tags(id).gold;
const isSent = (id: string) => tags(id).sentience;
const isBH = (id: string) => tags(id).blackHole;
const tagCount = (id: string) => +isGold(id) + +isSent(id) + +isBH(id);
const goldOnly = (id: string) => isGold(id) && !isSent(id) && !isBH(id);
const name = (id: string) => card(id).name;

/**
 * « La cible » sans précision = n'importe quel joueur (lanceur compris) pour qui l'effet est possible.
 * Le lanceur choisit parmi toutes les possibilités.
 */
const pickTarget = (x: Ctx, me: string, id: string, text: string, ok: (u: string) => boolean = () => true) =>
  x.choosePlayer(me, text, x.turnOrder().filter(ok), id);

/** Choisit un adversaire parmi ceux qui satisfont `ok` (effets sans intérêt sur soi : vol, don). */
const pickOpponent = (x: Ctx, me: string, id: string, text: string, ok: (u: string) => boolean = () => true) =>
  x.choosePlayer(me, text, x.others(me).filter(ok), id);

export const GOBLIN: Record<string, CardScript> = {
  // Marché d'outils astronomique
  "GOB-01": {
    activate: (x, { me }) => {
      if (!x.spend(me, 10)) return false;
      x.setBlackHole(me, Q);
    },
  },

  // Goblin Nécromancien
  "GOB-02": {
    activate: (x, { id, me }) => {
      const cost = x.p(me).blackHole === T ? 0 : 15;
      if (!x.p(me).discard.length || !x.canPay(me, cost)) return false;
      const q = cost ? `Dépenser ${cost} gold pour récupérer une carte de ta défausse ?` : "Récupérer une carte de ta défausse (gratuit grâce au trou de ver) ?";
      if (!x.confirm(me, q, id)) return false;
      x.spend(me, cost);
      const pick = x.random(x.p(me).discard); // « mélangez puis piochez » = une carte au hasard
      x.move(pick, { uid: me, zone: "deck", bottom: true });
      x.log(`« ${name(pick)} » est remise au fond de la pioche de ${x.name(me)}.`);
    },
  },

  // Goblin Voleur
  "GOB-03": {
    activate: (x, { id, me }) => {
      const t = pickOpponent(x, me, id, "Qui veux-tu voler ?", (u) => x.p(u).terrain.length > 0 && x.p(u).gold > 0);
      if (!t) return false;
      x.transfer(t, me, x.p(t).terrain.length * 2);
    },
  },

  // Banque Gobline : 5 gold pour tout le monde, 10 pour le lanceur et son équipe
  "GOB-04": {
    activate: (x, { me }) => {
      const team = x.team(me);
      for (const u of x.turnOrder()) x.gain(u, team.includes(u) ? 10 : 5);
    },
  },

  // Village Goblin
  "GOB-05": {
    activate: (x, { me }) => {
      let any = false;
      for (const u of x.team(me)) {
        if (u === me && (x.p(me).goldGainedLastTurn ?? 0) > 0) {
          x.log(`${x.name(me)} a gagné des gold au tour précédent : le Village ne s'applique pas à lui.`);
          continue;
        }
        x.invertSentience(u);
        x.cycleBlackHole(u, [P, Q, T, B]);
        any = true;
      }
      return any;
    },
  },

  // Barde TocToc
  "GOB-06": {
    activate: (x, { me }) => {
      const v = x.p(me).blackHole !== Q;
      for (const u of x.turnOrder()) x.setSentience(u, v);
    },
  },

  // Centre d'étude spatial goblin
  "GOB-07": {
    activate: (x, { me }) => {
      const ids = x.allTerrainCards().filter(isBH);
      if (!ids.length) return false;
      for (const c of ids) {
        x.move(c, { uid: me, zone: "deck" });
        x.take(c, me);
      }
      x.shuffleDeck(me);
    },
  },

  // INTERPOL
  "GOB-08": {
    activate: (x) => {
      const ids = x.allTerrainCards().filter(isGold);
      if (!ids.length) return false;
      for (const c of ids) x.discard(c);
    },
  },

  // Alchimiste Goblin : échange de place une carte Gold de la cible avec une des tiennes
  "GOB-09": {
    activate: (x, { id, me }) => {
      const mineAll = x.p(me).terrain.filter(isGold);
      if (!mineAll.length) return false;
      const t = pickTarget(x, me, id, "Sur quel terrain prendre une carte Gold ?", (u) =>
        u === me ? mineAll.length >= 2 : x.p(u).terrain.some(isGold));
      if (!t) return false;
      const theirs = x.chooseCard(me, `Carte Gold à prendre chez ${x.name(t)}`, x.p(t).terrain.filter(isGold), id);
      const mine = x.chooseCard(me, "Carte Gold de ton terrain à échanger avec", mineAll.filter((c) => c !== theirs), id);
      if (!theirs || !mine) return false;
      x.swap(mine, theirs);
    },
  },

  // Chasseur d'humains
  "GOB-10": {
    activate: (x, { id, me }) => {
      if (x.p(me).blackHole !== P) return false;
      x.setSentience(me, true);
      x.gain(me, 20);
      const c = x.chooseCard(me, "Défausse une carte de ta main", x.p(me).hand, id);
      if (c) x.discard(c);
    },
  },

  // Raid de goblins
  "GOB-11": {
    activate: (x, { id, me }) => {
      if (x.p(me).blackHole === B) return false;
      const t = pickTarget(x, me, id, "Quel joueur raider ?", (u) => x.p(u).hand.length > 0);
      if (!t) return false;
      const hand = x.p(t).hand;
      x.p(t).hand = hand.map((c) => [x.rand(), c] as const).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
      x.log(`${x.name(t)} mélange sa main.`);
      const c = x.chooseCard(me, `Choisis une carte (face cachée) dans la main de ${x.name(t)}`, x.p(t).hand, id, true);
      if (!c) return false;
      x.move(c, { uid: me, zone: "deck", bottom: true });
      x.take(c, me);
      x.setBlackHole(me, P);
      x.discard(id);
    },
  },

  // L'odyssée Gobline
  "GOB-12": {
    activate: (x, { id, me }) => {
      if (x.p(me).blackHole !== T || x.p(me).terrain.length < 2) return false;
      x.p(me).terrain = x.chooseOrder(me, "Réorganise ton terrain (ordre de lecture)", x.p(me).terrain, id);
      x.log(`${x.name(me)} réorganise son terrain.`);
    },
  },

  // Empereur des Goblins
  "GOB-13": {
    activate: (x, { id, me }) => {
      const terrain = x.p(me).terrain;
      const picks = x.chooseCards(me, "Cartes de ton terrain à défausser (+10 gold chacune)", terrain, 0, terrain.length, id);
      if (!picks.length) return false;
      for (const c of picks) x.discard(c);
      x.gain(me, picks.length * 10);
    },
  },

  // Fonctionnaire Goblin (passif)
  "GOB-14": {
    on: {
      sentience: (x, self, e) => {
        if (e.uid !== self.me) return;
        if (!e.v) {
          x.triggered(self, "sentience fausse → trou noir Quasar et pioche.");
          x.setBlackHole(self.me, Q);
          const from = x.choosePlayer(self.me, "Dans quelle pioche piocher une carte ?", x.turnOrder(), self.id);
          if (from) x.draw(self.me, 1, from);
        } else {
          x.triggered(self, "sentience vraie → +10 gold.");
          x.gain(self.me, 10);
        }
      },
    },
  },

  // Charlatan : chaque autre joueur, dans l'ordre, propose un prix ; le lanceur accepte ou non,
  // puis choisit le nouveau trou noir de ce joueur (différent de l'actuel).
  "GOB-15": {
    activate: (x, { id, me }) => {
      let any = false;
      for (const u of x.others(me)) {
        const max = x.p(u).gold;
        if (max < 1) continue;
        const n = x.chooseNumber(u, `Charlatan de ${x.name(me)} : combien lui proposes-tu pour qu'il change ton trou noir ? (0 = passer)`, 0, max, id);
        if (n < 1) {
          x.log(`${x.name(u)} passe son tour pour le Charlatan.`);
          continue;
        }
        if (!x.confirm(me, `${x.name(u)} te propose ${n} gold pour changer son trou noir. Accepter ?`, id)) {
          x.log(`${x.name(me)} refuse l'offre de ${x.name(u)} (${n} gold).`);
          continue;
        }
        x.transfer(u, me, n);
        x.setBlackHole(u, x.chooseBlackHole(me, `Nouveau trou noir de ${x.name(u)}`, x.p(u).blackHole, id));
        any = true;
      }
      x.reason = any ? null : "Personne n'a conclu d'accord avec le Charlatan.";
      return any;
    },
  },

  // Ingénierie Gobline
  "GOB-16": {
    activate: (x, { id, me }) => {
      x.draw(me, 6);
      const c = x.chooseCard(me, "Défausse une carte de ta main", x.p(me).hand, id);
      if (c) x.discard(c);
      x.discard(id);
    },
  },

  // Voyageur entropique
  "GOB-17": {
    activate: (x) => {
      for (const u of x.turnOrder()) x.cycleBlackHole(u, [P, Q, B, T]);
    },
  },

  // Expert Comptable : tes cartes Sentience ↔ les cartes Gold de la cible
  "GOB-18": {
    activate: (x, { id, me }) => {
      const mine = x.p(me).terrain.filter((c) => c !== id && isSent(c));
      const target = pickTarget(x, me, id, "Avec qui échanger ?", (u) => mine.length > 0 || x.p(u).terrain.some(isGold));
      if (!target) return false;
      const theirs = x.p(target).terrain.filter((c) => c !== id && isGold(c) && !mine.includes(c));
      // La 1re carte 🧠 prend la place de la 1re carte 💰 et inversement, etc.
      const n = Math.min(mine.length, theirs.length);
      for (let i = 0; i < n; i++) x.swap(mine[i], theirs[i]);
      // Sans correspondance : les cartes restantes vont à la fin de l'autre terrain, dans leur ordre.
      for (const c of mine.slice(n)) x.moveExchange(c, { uid: target, zone: "terrain" });
      for (const c of theirs.slice(n)) x.moveExchange(c, { uid: me, zone: "terrain" });
    },
  },

  // Cobaye Goblin
  "GOB-19": {
    activate: (x, { me }) => {
      if (x.p(me).blackHole === B) x.gain(me, 50);
      else return x.spend(me, 10);
    },
  },

  // Lord McGoblin
  "GOB-20": {
    activate: (x) => {
      for (const u of x.turnOrder()) x.invertSentience(u);
    },
  },

  // Fusée Gobline IX
  "GOB-21": {
    activate: (x, { id, me }) => {
      for (const c of x.p(me).terrain.filter((c) => c !== id && isGold(c))) x.discard(c);
      x.setBlackHole(me, x.chooseBlackHole(me, "Choisis ton trou noir", undefined, id));
      x.setSentience(me, x.chooseOption(me, "Choisis ta sentience", ["Vraie", "Fausse"], id) === 0);
      x.discard(id);
    },
  },

  // Négociateur : la cible choisit la carte de ta main qu'elle reçoit
  "GOB-22": {
    activate: (x, { id, me }) => {
      if (!x.p(me).hand.length) return false;
      const t = pickOpponent(x, me, id, "À qui donner une carte ?");
      if (!t) return false;
      const c = x.chooseCard(t, `${x.name(me)} te donne une carte de sa main : choisis-la`, x.p(me).hand, id);
      if (c) x.move(c, { uid: t, zone: "hand" });
      x.gain(me, 25);
      x.discard(id);
    },
  },

  // Quartier des plaisirs
  "GOB-23": {
    activate: (x, { id, me }) => {
      const bh = x.p(me).blackHole;
      if (bh === P || bh === B) {
        x.gain(me, 30);
        const c = x.chooseCard(me, "Carte de ta main à mettre au fond de ta pioche", x.p(me).hand, id);
        if (c) x.move(c, { uid: me, zone: "deck", bottom: true });
      } else {
        x.gain(me, 10);
        x.draw(me, 1);
      }
    },
  },

  // Agriculture d'origine contrôlée (passif)
  "GOB-24": {
    on: {
      blackHole: (x, self, e) => {
        if (e.uid !== self.me || e.to !== P) return;
        x.triggered(self, "trou noir Primordial → sentience vraie et +20 gold.");
        x.setSentience(self.me, true);
        x.gain(self.me, 20);
      },
    },
  },

  // Héros Goblin
  "GOB-25": {
    activate: (x, { id, me }) => {
      const t = pickTarget(x, me, id, "Quelle cible ?", (u) => x.p(u).terrain.some((c) => c !== id && tagCount(c) >= 2));
      if (!t) return false;
      for (const c of x.p(t).terrain.filter((c) => c !== id && tagCount(c) >= 2)) x.move(c, { uid: t, zone: "discard" });
      x.discard(id);
    },
  },

  // Explorateur spatio-temporel Goblin
  "GOB-26": {
    activate: (x, { id, me }) => {
      const ok = (c: string) => isSent(c) && isBH(c) && !isGold(c);
      const t = pickTarget(x, me, id, "Sur quel terrain prendre la carte ?", (u) => x.p(u).terrain.some((c) => c !== id && ok(c)));
      if (!t) return false;
      const c = x.chooseCard(me, `Carte 🧠🌀 à prendre chez ${x.name(t)}`, x.p(t).terrain.filter((c) => c !== id && ok(c)), id);
      if (!c) return false;
      x.move(c, { uid: me, zone: "hand" });
      x.take(c, me);
    },
  },

  // Chambre du commerce
  "GOB-27": {
    activate: (x, { id, me }) => {
      // Le lanceur choisit l'action, puis le terrain, puis la carte, parmi tout ce qui est possible.
      const all = x.turnOrder();
      const withGold = all.filter((u) => x.p(u).terrain.some((c) => c !== id && goldOnly(c)));
      const canPlace = x.p(me).hand.some(goldOnly);
      const opts = [
        withGold.length ? "Défausser une carte uniquement Gold d'un terrain" : "",
        canPlace ? "Poser une carte uniquement Gold de ta main sur un terrain" : "",
      ].filter(Boolean);
      if (!opts.length) return false;
      const choice = opts[x.chooseOption(me, "Chambre du commerce : que fais-tu ?", opts, id)];
      if (choice.startsWith("Défausser")) {
        const t = x.choosePlayer(me, "Sur quel terrain défausser ?", withGold, id)!;
        const c = x.chooseCard(me, `Carte uniquement Gold à défausser chez ${x.name(t)}`, x.p(t).terrain.filter((c) => c !== id && goldOnly(c)), id);
        if (c) x.discard(c);
      } else {
        const c = x.chooseCard(me, "Carte uniquement Gold de ta main à poser", x.p(me).hand.filter(goldOnly), id);
        const t = x.choosePlayer(me, "Sur quel terrain la poser ?", all, id)!;
        if (!c) return false;
        const at = x.chooseSlot(me, `À quelle place poser « ${name(c)} » chez ${x.name(t)} ?`, t, c, id);
        x.move(c, { uid: t, zone: "terrain", index: at });
      }
    },
  },

  // Réacteur au miel plasma : autant de fois que voulu
  "GOB-28": {
    activate: (x, { id, me }) => {
      const cycle = [P, T, Q, B];
      let n = 0;
      while (n < 30 && x.canPay(me, 20)) {
        const next = cycle[(cycle.indexOf(x.p(me).blackHole) + 1) % 4];
        if (!x.confirm(me, `Dépenser 20 gold : ${x.p(me).blackHole} → ${next} ?`, id)) break;
        x.spend(me, 20);
        x.setBlackHole(me, next);
        n++;
      }
      return n > 0;
    },
  },

  // Spatio-Assassin Goblin
  "GOB-29": {
    activate: (x, { id, me }) => {
      const t = pickTarget(x, me, id, "Quelle cible ?");
      if (!t) return false;
      x.cycleBlackHole(t, [P, B, T, Q]);
    },
  },

  // Hôpital du Dr. Goblinstein : règle permanente gérée par le moteur (moveCard)
  "GOB-30": {},

  // Le donjon goblin : une chance sur quatre (il faut un 4 au d4)
  "GOB-31": {
    activate: (x, { id, me }) => {
      const v = x.dice(me, 2);
      if (v !== 2) {
        x.reason = `Le dé donne ${v} : il fallait un 2.`;
        return false;
      }
      const t = pickTarget(x, me, id, "Quelle cible ?");
      if (!t) return false;
      const first = x.p(t).terrain[0];
      if (first) x.discard(first);
      x.shuffleZone(t, "deck");
      x.shuffleZone(t, "discard");
    },
  },

  // Mercenaire Goblin
  "GOB-32": {
    activate: (x, { id, me }) => {
      const targets = x.allTerrainCards().filter((c) => c !== id);
      if (!targets.length || !x.canPay(me, 50)) return false;
      if (!x.confirm(me, "Payer 50 gold pour défausser une carte d'un terrain ?", id)) return false;
      const c = x.chooseCard(me, "Carte à défausser", targets, id);
      if (!c) return false;
      x.spend(me, 50);
      x.discard(c);
    },
  },
};

// Garde-fou : si l'ordre des cartes change dans le tableau, on le saura.
const EXPECTED: Record<string, string> = {
  "GOB-01": "Marché d'outils astronomique", "GOB-11": "Raid de goblins", "GOB-14": "Fonctionaire Goblin",
  "GOB-24": "Agriculture d'origine controlé", "GOB-30": "Hopital du Dr. Goblinstein", "GOB-32": "Mercenaire Goblin",
};
for (const [id, n] of Object.entries(EXPECTED)) {
  if (card(id).name !== n) console.warn(`Tokards : ${id} devrait être « ${n} », trouvé « ${card(id).name} ».`);
}
