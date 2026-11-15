// Popo emplois — effets automatiques. Les choix d'interprétation sont notés dans
// la colonne « Précisions » du tableau des cartes.
// Règles communes : 10 % = arrondi à l'inférieur ; « le plus riche / pauvre » : tirage au hasard en cas
// d'égalité ; « payer X » est optionnel (le joueur confirme) et échoue s'il n'a pas assez de gold.
import { card } from "../data/cards";
import type { BlackHole } from "../game/types";
import { BLACK_HOLES } from "../game/types";
import type { CardScript, Ctx } from "./runtime";

const B: BlackHole = "Blazard";
const isGold = (id: string) => card(id).tags.gold;
const isBH = (id: string) => card(id).tags.blackHole;

/** Paiement optionnel : faux si le joueur ne peut pas ou ne veut pas payer. */
function pay(x: Ctx, me: string, id: string, n: number, what: string) {
  if (!x.canPay(me, n)) {
    x.log(`${x.name(me)} n'a pas assez de gold (${n} requis).`);
    return false;
  }
  if (!x.confirm(me, `Payer ${n} gold pour ${what} ?`, id)) return false;
  return x.spend(me, n);
}

/** Pose sur le terrain de `uid` les cartes qu'il vient de piocher (sans les activer). */
function drawToTerrain(x: Ctx, uid: string, n: number, from: string) {
  const before = new Set(x.p(uid).hand);
  x.draw(uid, n, from);
  for (const c of x.p(uid).hand.filter((c) => !before.has(c))) x.move(c, { uid, zone: "terrain" });
}

/** Plus longue suite de joueurs consécutifs (dans l'ordre du tour, en boucle) qui vérifient `ok`. */
function longestRun(order: string[], ok: (u: string) => boolean) {
  if (order.every(ok)) return order.length;
  let best = 0;
  let run = 0;
  for (let i = 0; i < order.length * 2; i++) {
    run = ok(order[i % order.length]) ? run + 1 : 0;
    best = Math.max(best, Math.min(run, order.length));
  }
  return best;
}

export const POPO: Record<string, CardScript> = {
  // Poro lumineux
  "POP-01": { activate: (x, { me }) => void x.draw(me, x.p(me).sentience ? 1 : 2) },

  // Poro gourmand : 10 gold par carte 💰 de son terrain (elle comprise)
  "POP-02": {
    activate: (x, { me }) => {
      const n = x.p(me).terrain.filter(isGold).length;
      if (!n) return false;
      x.gain(me, 10 * n);
    },
  },

  // Poro magicien
  "POP-03": {
    activate: (x) => {
      const all = x.turnOrder();
      if (new Set(all.map((u) => x.p(u).blackHole)).size < 3) return false;
      const pool = all.filter((u) => !x.isBlazard(u));
      if (!pool.length) return false;
      x.setBlackHole(x.random(pool), B);
    },
  },

  // Poro boss : les voisins (ordre du tour) du plus riche passent en Blazard
  "POP-04": {
    activate: (x) => {
      const o = x.order;
      if (o.length < 2) return false;
      const rich = x.richest(o)!;
      const i = o.indexOf(rich);
      const around = [...new Set([o[(i - 1 + o.length) % o.length], o[(i + 1) % o.length]])].filter((u) => u !== rich);
      x.log(`Le plus riche est ${x.name(rich)}.`);
      for (const u of around) x.setBlackHole(u, B);
    },
  },

  // Poro money maker (passif) : +10 gold à chaque interaction ; si sentience vraie, son trou noir passe en Blazard
  "POP-05": {
    on: {
      interaction: (x, self) => {
        x.triggered(self, "interaction → +10 gold.");
        x.gain(self.me, 10);
        if (x.p(self.me).sentience) x.setBlackHole(self.me, B);
      },
    },
  },

  // Poro temps : en Blazard, la première carte 💰 de son terrain s'active une deuxième fois
  "POP-06": {
    activate: (x, { id, me }) => {
      if (!x.isBlazard(me)) return false;
      const first = x.p(me).terrain.find((c) => c !== id && isGold(c));
      if (!first) return false;
      x.log(`« ${card(first).name} » est rejouée une deuxième fois.`);
      x.activateCard(first, me);
    },
  },

  // Poro malicieux
  "POP-07": {
    activate: (x, { id, me }) => {
      const others = x.others(me);
      if (others.length < 2) return false;
      const a = x.choosePlayer(me, "Premier joueur dont les gold seront échangés :", others, id)!;
      const b = x.choosePlayer(me, `Échanger les gold de ${x.name(a)} avec :`, others.filter((u) => u !== a), id)!;
      x.swapGold(a, b);
      if (!x.p(me).sentience) for (const u of [a, b]) x.transfer(u, me, x.pct(x.p(u).gold));
    },
  },

  // Poro marchand
  "POP-08": {
    activate: (x, { me }) => {
      x.invertSentience(me);
      x.gain(me, 5);
    },
  },

  // Poro fan
  "POP-09": {
    activate: (x, { id, me }) => {
      if (x.p(me).sentience) return void x.gain(me, 20);
      const t = x.choosePlayer(me, "Qui veux-tu voler (10 gold) ?", x.others(me).filter((u) => x.p(u).gold > 0), id);
      if (!t) return false;
      x.transfer(t, me, 10);
    },
  },

  // Poro harceleur : un Blazard au hasard paie 10 % de ses gold au lanceur
  "POP-10": {
    activate: (x, { me }) => {
      const pool = x.others(me).filter(x.isBlazard);
      if (!pool.length) return false;
      const t = x.random(pool);
      x.transfer(t, me, x.pct(x.p(t).gold));
    },
  },

  // Poro gaming : chaque Blazard donne 10 % de ses gold au lanceur
  "POP-11": {
    activate: (x, { me }) => {
      const pool = x.others(me).filter(x.isBlazard);
      if (!pool.length) return false;
      for (const u of pool) x.transfer(u, me, x.pct(x.p(u).gold));
    },
  },

  // Poro bête : deux joueurs défaussent leur terrain puis posent autant de cartes piochées chez l'autre
  "POP-12": {
    activate: (x, { id, me }) => {
      const all = x.turnOrder();
      if (all.length < 2 || !pay(x, me, id, 200, "cibler deux joueurs (Poro bête)")) return false;
      const a = x.choosePlayer(me, "Premier joueur ciblé :", all, id)!;
      const b = x.choosePlayer(me, "Second joueur ciblé :", all.filter((u) => u !== a), id)!;
      const na = x.p(a).terrain.filter((c) => c !== id).length;
      const nb = x.p(b).terrain.filter((c) => c !== id).length;
      for (const u of [a, b]) for (const c of [...x.p(u).terrain]) if (c !== id) x.discard(c);
      drawToTerrain(x, a, na, b);
      drawToTerrain(x, b, nb, a);
    },
  },

  // Poro assassin
  "POP-13": {
    activate: (x, { id, me }) => {
      const others = x.others(me);
      if (!others.length || !pay(x, me, id, 25, "bloquer un joueur au hasard")) return false;
      const t = x.random(others);
      x.lock(t);
      const first = x.p(t).terrain[0];
      if (first) x.discard(first);
    },
  },

  // Poro président
  "POP-14": {
    activate: (x, { id, me }) => {
      if (x.p(me).sentience) return void x.draw(me, 1);
      const t = x.choosePlayer(me, "Quel joueur perd la dernière carte de son terrain ?", x.turnOrder().filter((u) => x.p(u).terrain.some((c) => c !== id)), id);
      if (!t) return false;
      const last = [...x.p(t).terrain].reverse().find((c) => c !== id)!;
      x.discard(last);
    },
  },

  // Poro surprise : la main du joueur ciblé retourne dans sa pioche, il pioche autant de cartes
  "POP-15": {
    activate: (x, { id, me }) => {
      const pool = x.turnOrder().filter((u) => x.p(u).hand.length > 0);
      if (!pool.length || !pay(x, me, id, 35, "faire repiocher une main")) return false;
      const t = x.choosePlayer(me, "Quelle main repiocher ?", pool, id)!;
      const n = x.p(t).hand.length;
      for (const c of [...x.p(t).hand]) x.move(c, { uid: t, zone: "deck" });
      x.shuffleDeck(t);
      x.draw(t, n);
    },
  },

  // Poro cupidon
  "POP-16": {
    activate: (x) => {
      for (const u of x.turnOrder()) {
        if (x.p(u).gold % 2 === 0) {
          x.setSentience(u, true);
          x.setBlackHole(u, B);
        } else x.setSentience(u, false);
      }
    },
  },

  // Poro artiste : les mains des joueurs Blazard (sauf le lanceur) tournent
  "POP-17": {
    activate: (x, { id, me }) => {
      const pool = x.others(me).filter(x.isBlazard);
      if (pool.length < 2 || !pay(x, me, id, 45, "échanger les mains des joueurs Blazard")) return false;
      x.rotateHands(pool);
    },
  },

  // Popo au chômage
  "POP-18": {
    activate: (x, { id, me }) => {
      if (!x.p(me).sentience) return void x.setBlackHole(me, B);
      const t = x.choosePlayer(me, "Quel joueur passe en Blazard ?", x.others(me), id);
      if (!t) return false;
      x.setBlackHole(t, B);
    },
  },

  // Poro forgeron : 2 joueurs au hasard (lanceur compris, déjà Blazard possible) passent en Blazard
  "POP-19": {
    activate: (x, { id, me }) => {
      if (!pay(x, me, id, 15, "passer 2 trous noirs au hasard en Blazard")) return false;
      const pool = [...x.turnOrder()];
      for (let k = 0; k < 2 && pool.length; k++) {
        const u = x.random(pool);
        pool.splice(pool.indexOf(u), 1);
        x.log(`Le forgeron cible ${x.name(u)}.`);
        x.setBlackHole(u, B);
      }
    },
  },

  // Poro petite fille
  "POP-20": {
    activate: (x) => {
      const poor = x.poorest(x.turnOrder())!;
      if (!x.p(poor).sentience) return false;
      x.setBlackHole(poor, B);
    },
  },

  // Poro gros cerveau
  "POP-21": {
    activate: (x, { me }) => {
      for (const u of x.others(me).filter(x.isBlazard)) x.transfer(u, me, x.pct(x.p(u).gold));
      x.setBlackHole(me, B);
    },
  },

  // Poro tank : si tout le monde est Blazard, chaque autre joueur défausse une carte au hasard de son terrain et pioche
  "POP-22": {
    activate: (x, { me }) => {
      if (!x.turnOrder().every(x.isBlazard)) return false;
      for (const u of x.others(me)) {
        if (x.p(u).terrain.length) x.discard(x.random(x.p(u).terrain));
        x.draw(u, 1);
      }
    },
  },

  // Poro saint (hors lanceur)
  "POP-23": {
    activate: (x, { me }) => {
      const others = x.others(me);
      if (others.length < 2) return false;
      const rich = x.richest(others)!;
      const poor = x.poorest(others.filter((u) => u !== rich))!;
      x.transfer(rich, poor, x.pct(x.p(rich).gold));
      x.setBlackHole(rich, B);
    },
  },

  // Poro méchant : le lanceur choisit la carte défaussée chez le plus pauvre (hors lui)
  "POP-24": {
    activate: (x, { id, me }) => {
      const poor = x.poorest(x.others(me));
      if (!poor || !x.p(poor).terrain.length) return false;
      const c = x.chooseCard(me, `Quelle carte du terrain de ${x.name(poor)} défausser ?`, x.p(poor).terrain, id);
      if (!c) return false;
      x.discard(c);
    },
  },

  // Poro justicier
  "POP-25": {
    activate: (x, { me }) => {
      const all = x.turnOrder();
      const yes = all.filter((u) => x.p(u).sentience).length;
      const no = all.length - yes;
      x.log(`Sentience : ${yes} vraie(s), ${no} fausse(s).`);
      if (yes >= no) {
        for (const u of x.others(me).filter(x.isBlazard)) {
          const c = x.p(u).terrain.find(isBH);
          if (c) x.discard(c);
        }
      }
      if (no >= yes) {
        const blaz = all.filter(x.isBlazard);
        const rest = all.filter((u) => !x.isBlazard(u));
        for (const thief of blaz) for (const v of rest) x.transfer(v, thief, 10);
      }
    },
  },

  // Poro train
  "POP-26": {
    activate: (x) => {
      const o = x.order;
      if (o.length < 2 || longestRun(o, x.isBlazard) < o.length - 1) return false;
      for (const u of x.turnOrder().filter(x.isBlazard)) x.gain(u, 200);
    },
  },

  // Poro peintre
  "POP-27": {
    activate: (x, { id, me }) => {
      if (!pay(x, me, id, 10, "inverser toutes les sentiences et changer tous les trous noirs")) return false;
      for (const u of x.turnOrder()) {
        x.invertSentience(u);
        x.setBlackHole(u, x.random(BLACK_HOLES).id);
      }
    },
  },

  // Poro soldat
  "POP-28": {
    activate: (x) => {
      const pool = x.turnOrder().filter((u) => !x.isBlazard(u));
      if (!pool.length) return false;
      for (const u of pool) x.invertSentience(u);
    },
  },

  // Poro scam
  "POP-29": {
    activate: (x, { me }) => {
      if (!x.isBlazard(me)) return void x.setBlackHole(me, B);
      const rich = x.richest(x.others(me));
      if (!rich || !x.draw(me, 1, rich)) return false;
    },
  },

  // Poro des bois (hors lanceur)
  "POP-30": {
    activate: (x, { me }) => {
      const others = x.others(me);
      if (others.length < 2) return false;
      const rich = x.richest(others)!;
      if (!x.isBlazard(rich)) return false;
      const poor = x.poorest(others.filter((u) => u !== rich))!;
      x.transfer(rich, poor, x.pct(x.p(rich).gold));
    },
  },

  // Poro ? Crapeau : 10 % de chaque joueur concerné, partagés à parts égales entre tous
  "POP-31": {
    activate: (x, { me }) => {
      const all = x.turnOrder();
      const payers = all.filter((u) => (x.p(me).sentience ? !x.isBlazard(u) : x.isBlazard(u)));
      if (!payers.length) return false;
      let pot = 0;
      for (const u of payers) pot += x.lose(u, x.pct(x.p(u).gold));
      const share = Math.floor(pot / all.length);
      x.log(`Cagnotte : ${pot} gold, ${share} pour chacun.`);
      for (const u of all) x.gain(u, share);
      x.moved(share * all.length);
    },
  },

  // Poro prostitué : échange la main de deux joueurs (lanceur compris)
  "POP-32": {
    activate: (x, { id, me }) => {
      const all = x.turnOrder();
      if (all.length < 2 || !pay(x, me, id, 25, "échanger deux mains")) return false;
      const a = x.choosePlayer(me, "Première main à échanger :", all, id)!;
      const b = x.choosePlayer(me, `Échanger la main de ${x.name(a)} avec :`, all.filter((u) => u !== a), id)!;
      x.rotateHands([a, b]);
    },
  },
};

// Garde-fou : si le tableau est réorganisé, on le signale au lieu d'appliquer le mauvais effet.
const EXPECTED: Record<string, string> = {
  "POP-01": "Poro lumineux", "POP-05": "Poro money maker", "POP-12": "Poro bête", "POP-24": "Poro méchant", "POP-32": "Poro prostitué",
};
for (const [id, n] of Object.entries(EXPECTED)) {
  if (card(id).name !== n) console.warn(`Tokards : ${id} devrait être « ${n} », trouvé « ${card(id).name} ».`);
}
