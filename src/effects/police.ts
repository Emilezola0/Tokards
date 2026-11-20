// Police — effets automatiques. Presque toutes les cartes coûtent 10 gold : le coût est payé d'abord, même si
// l'effet échoue ensuite ; sans assez de gold, l'effet ne s'active pas. Les passifs payants paient leur coût à chaque
// fois qu'ils se jouent (phase 1, ou à la pose) : non payés, ils sont désactivés jusqu'au début du prochain tour.
// « Désactiver » sans durée = jusqu'à nouvel ordre.
// Les choix d'interprétation sont notés dans la colonne « Précisions » du tableau.
import { card } from "../data/cards";
import * as E from "../game/engine";
import type { BlackHole } from "../game/types";
import type { CardScript, Ctx, Self } from "./runtime";

const P: BlackHole = "Primordial";
const Q: BlackHole = "Quasar";
const B: BlackHole = "Blazard";
const T: BlackHole = "Trou de ver";

const pay = (x: Ctx, me: string) => x.spend(me, 10);
const last = <T,>(a: T[]) => a[a.length - 1];
const isArmed = (x: Ctx, id: string) => (x.g.armed ?? []).includes(id);
const arm = (x: Ctx, id: string) => !isArmed(x, id) && (x.g.armed = [...(x.g.armed ?? []), id]);
const disarm = (x: Ctx, id: string) => (x.g.armed = (x.g.armed ?? []).filter((c) => c !== id));
/** Joueur chez qui se trouve la carte (ou son propriétaire si elle n'est plus en jeu). */
const holderOf = (x: Ctx, id: string) => E.locate(x.g, id)?.uid ?? x.g.owner[id];
/** Toutes les cartes des terrains sauf `except`. */
const terrainCards = (x: Ctx, except: string) => x.allTerrainCards().filter((c) => c !== except);

/** Passif payant : 10 gold à chaque fois qu'il se joue ; sinon il est désactivé jusqu'au début du prochain tour. */
const upkeep =
  (bh?: BlackHole) =>
  (x: Ctx, { id, me }: Self) => {
    if (!pay(x, me)) {
      x.log(`« ${card(id).name} » n'est pas payée : son passif est désactivé jusqu'au début du prochain tour de ${x.name(me)}.`, { dst: id });
      x.disable(id, x.untilStartOfNext(me));
      return false;
    }
    if (bh) x.setBlackHole(me, bh);
  };
/** Fin du tour du joueur `u` (le tour en cours si c'est le sien). */
const untilEndOfTurnOf = (x: Ctx, u: string) => (u === x.current ? x.untilEndOfTurn() : x.untilEndOfNext(u));

/** Choisit une carte d'un terrain (sauf la carte qui agit). */
function pickCard(x: Ctx, me: string, id: string, text: string, pool = terrainCards(x, id)) {
  const c = x.chooseCard(me, text, pool, id);
  if (!c) x.reason = "Aucune carte à cibler sur les terrains.";
  return c;
}

/** BAC : un vol est annulé, la carte voleuse et le BAC sont défaussés, puis +1d100 gold. */
function bacCancel(x: Ctx, self: Self, src: string | null | undefined) {
  if (src && src !== self.id && E.locate(x.g, src)?.zone === "terrain") x.discard(src);
  x.discard(self.id);
  x.gain(self.me, x.dice(self.me, 100));
}

export const POLICE: Record<string, CardScript> = {
  // CRS : désactive la première carte d'un terrain et le CRS jusqu'à la fin de ton prochain tour
  "POL-01": {
    activate: (x, { id, me }) => {
      if (!pay(x, me)) return false;
      const pool = x.turnOrder().filter((u) => x.p(u).terrain.some((c) => c !== id));
      const u = x.choosePlayer(me, "CRS : quel terrain cibler ?", pool, id);
      if (!u) return false;
      const first = x.p(u).terrain.find((c) => c !== id)!;
      x.disable(first, x.untilEndOfNext(me));
      x.disable(id, x.untilEndOfNext(me));
    },
  },

  // BAC (passif) : annule le premier vol subi (carte ou gold)
  "POL-02": {
    activate: upkeep(),
    on: {
      steal: (x, self, e) => {
        if (e.victim !== self.me || !e.from) return;
        x.triggered(self, `vol de « ${card(e.card).name} » annulé.`);
        x.moveExchange(e.card, {
          uid: e.from.uid,
          zone: e.from.zone,
          index: e.from.index,
        });
        x.take(e.card, e.from.uid);
        bacCancel(x, self, e.src);
      },
      goldStolen: (x, self, e) => {
        if (e.victim !== self.me) return;
        x.triggered(self, `vol de ${e.amount} gold annulé.`);
        x.giveBack(e.thief, self.me, e.amount);
        bacCancel(x, self, e.src);
      },
    },
  },

  // Flashball : Quasar, puis une chance sur deux de défausser la carte ciblée ou celle d'après ; retourne dans ta pioche
  "POL-03": {
    activate: (x, { id, me }) => {
      if (!pay(x, me)) return false;
      const pool = terrainCards(x, id);
      if (!pool.length) {
        x.reason = "Aucune carte à cibler sur les terrains.";
        return false;
      }
      x.setBlackHole(me, Q);
      const c = pickCard(x, me, id, "Flashball : quelle carte viser ?", pool)!;
      const at = E.locate(x.g, c)!;
      const next = x.p(at.uid).terrain[at.index + 1];
      if (x.dice(me, 2) === 1) x.discard(c);
      else if (next && next !== id) x.discard(next);
      else x.log("Il n'y a pas de carte après : le tir rate.");
      if (E.locate(x.g, id)?.zone === "terrain") {
        x.move(id, { uid: me, zone: "deck" });
        x.shuffleZone(me, "deck");
      }
    },
  },

  // Gaz lacrymogène : Blazard, se pose où tu veux, désactive ses voisines, revient dans ta pioche en fin de tour
  "POL-04": {
    activate: (x, { id, me }) => {
      if (!pay(x, me)) return false;
      x.setBlackHole(me, B);
      const u = x.choosePlayer(me, "Gaz lacrymogène : sur quel terrain le lancer ?", x.turnOrder(), id)!;
      const at = E.locate(x.g, id);
      if (at?.zone === "terrain") {
        // La place choisie est une position d'insertion : le moteur gère le décalage dans un même terrain.
        const slot = x.chooseSlot(me, "À quelle place ?", u, id, id);
        if (u !== at.uid || (slot !== at.index && slot !== at.index + 1)) x.move(id, { uid: u, zone: "terrain", index: slot });
      }
      const now = E.locate(x.g, id);
      if (now?.zone !== "terrain") return;
      const t = x.p(now.uid).terrain;
      const until = untilEndOfTurnOf(x, now.uid);
      for (const c of [t[now.index - 1], t[now.index + 1]]) if (c) x.disable(c, until);
      x.g.marks = { ...(x.g.marks ?? {}), [id]: `${me}|${now.uid}` };
      arm(x, id);
      // Puis le gaz se désactive lui-même ; sa fin de tour se joue quand même (evenDisabled).
      if (E.locate(x.g, id)?.zone === "terrain") {
        E.disableCard(x.g, id, until);
        x.log("😶‍🌫️ Le Gaz lacrymogène se désactive lui-même (sa fin de tour se jouera quand même).", { dst: id });
      }
    },
    evenDisabled: true,
    on: {
      turnEnd: (x, self, e) => {
        if (!isArmed(x, self.id)) return;
        const [caster, target] = (x.g.marks?.[self.id] ?? "").split("|");
        if (target && e.uid !== target) return;
        disarm(x, self.id);
        const back = caster || x.g.owner[self.id];
        if (!back || !x.p(back)) return;
        x.triggered(self, "le gaz se dissipe : les voisines sont réactivées, la carte revient dans la pioche.");
        const at = E.locate(x.g, self.id);
        if (at?.zone === "terrain") {
          const t = x.p(at.uid).terrain;
          // Seules les voisines désactivées par le gaz lui-même sont réactivées.
          for (const c of [t[at.index - 1], t[at.index + 1]]) if (c && x.g.disabled?.[c] && x.g.disabledBy?.[c]?.src === self.id) x.enable(c);
        }
        x.move(self.id, { uid: back, zone: "deck" });
        x.shuffleZone(back, "deck");
      },
    },
  },

  // Ministre de l'intérieur (passif) : +50 gold en arrivant ; à 0 gold il défausse tout ton terrain ;
  // chaque carte que tu défausses te coûte 10 gold
  "POL-05": {
    // Gagnez 50 💰 à chaque fois que la carte se joue (pose, phase 1, réactivation).
    activate: (x, { me }) => {
      x.gain(me, 50);
    },
    on: {
      zeroGold: (x, self, e) => {
        if (e.uid !== self.me) return;
        x.once(`zero:${self.id}`, () => {
          x.triggered(self, "plus de gold : tout le terrain est défaussé.");
          for (const c of [...x.p(self.me).terrain]) x.discard(c);
        });
      },
      cardMoved: (x, self, e) => {
        if (e.to?.zone !== "discard" || e.card === self.id || e.src === self.id) return;
        const mine = e.src ? (x.g.owner[e.src] ?? holderOf(x, e.src)) === self.me : e.from.uid === self.me && e.from.zone === "hand";
        if (!mine) return;
        x.triggered(self, `« ${card(e.card).name} » défaussée → −10 gold.`);
        if (x.canPay(self.me, 10)) x.spend(self.me, 10);
        else x.lose(self.me, 10);
      },
    },
  },

  // Perquisition : Trou de ver ; les cartes désactivées du terrain ciblé sont défaussées, puis tout le terrain
  // est désactivé jusqu'au début du prochain tour de son joueur ; la Perquisition est défaussée
  "POL-06": {
    activate: (x, { id, me }) => {
      if (!pay(x, me)) return false;
      const pool = x.turnOrder().filter((u) => x.p(u).terrain.some((c) => c !== id));
      const u = x.choosePlayer(me, "Perquisition : quel terrain fouiller ?", pool, id);
      if (!u) return false;
      x.setBlackHole(me, T);
      for (const c of x.p(u).terrain.filter((c) => c !== id && x.isDisabled(c))) x.discard(c);
      for (const c of x.p(u).terrain.filter((c) => c !== id)) x.disable(c, x.untilStartOfNext(u));
      x.discard(id);
    },
  },

  // Chef d'enquête : désactive une carte jusqu'au début du prochain tour de son joueur ;
  // à la fin de chaque tour, 1d6 : sur 6 elle est défaussée
  "POL-07": {
    activate: (x, { id, me }) => {
      if (!pay(x, me)) return false;
      const pool = terrainCards(x, id);
      if (!pool.length) {
        x.reason = "Aucune carte à cibler sur les terrains.";
        return false;
      }
      const c = pickCard(x, me, id, "Chef d'enquête : quelle carte mettre sous enquête ?", pool)!;
      x.disable(c, x.untilStartOfNext(E.locate(x.g, c)!.uid));
      x.g.marks = { ...(x.g.marks ?? {}), [id]: c };
    },
    on: {
      turnEnd: (x, self) => {
        const c = x.g.marks?.[self.id];
        if (!c) return;
        if (E.locate(x.g, c)?.zone !== "terrain") {
          const m = { ...x.g.marks };
          delete m[self.id];
          x.g.marks = m;
          return;
        }
        x.triggered(self, `enquête sur « ${card(c).name} » : 1d6.`);
        if (x.dice(self.me, 6) === 6) {
          x.discard(c);
          const m = { ...x.g.marks };
          delete m[self.id];
          x.g.marks = m;
        }
      },
    },
  },

  // Garde à vue : les prochaines cartes désactivées vont sous elle jusqu'à la fin de ton prochain tour
  "POL-08": {
    activate: (x, { id, me }) => {
      if (x.g.custody?.host === id) {
        x.log(`🚔 Garde à vue déjà en cours (${x.g.under?.[id]?.length ?? 0} carte(s) dessous).`);
        return;
      }
      if (!pay(x, me)) return false;
      x.g.custody = { host: id, uid: me, at: E.pos(x.g) };
      x.log("🚔 Garde à vue : les prochaines cartes désactivées seront placées sous cette carte.");
    },
    beforeLeave: (x, self) => {
      if (x.g.custody?.host === self.id) x.releaseCustody(false);
    },
    on: {
      turnEnd: (x, self, e) => {
        const c = x.g.custody;
        if (!c || c.host !== self.id || e.uid !== c.uid || E.pos(x.g) <= c.at) return;
        x.g.custody = null;
        const n = x.g.under?.[self.id]?.length ?? 0;
        const st = E.st(x.p(c.uid));
        for (const p of x.g.under?.[self.id] ?? []) {
          const from = x.g.underFrom?.[p]?.uid ?? x.g.owner[p];
          if (from && from !== c.uid) st.discOthers = (st.discOthers ?? 0) + 1;
        }
        if (!n) {
          // Personne dessous : la garde à vue se réactive jusqu'à la fin du prochain tour.
          x.g.custody = { ...c, at: E.pos(x.g) };
          x.triggered(self, "aucune carte dessous : la garde à vue se réactive jusqu'à la fin de ton prochain tour.");
          return;
        }
        x.triggered(self, `fin de la garde à vue : la carte et ses ${n} prisonnière(s) vont à la défausse.`);
        x.discard(self.id);
      },
    },
  },

  // Préfet de police (passif) : pioche 1 carte en arrivant ; +20 gold quand une de tes cartes défausse une carte d'un autre terrain
  "POL-09": {
    // Piochez une carte à chaque fois que la carte se joue.
    activate: (x, { me }) => {
      x.draw(me, 1);
    },
    on: {
      terrainDiscard: (x, self, e) => {
        if (e.uid === self.me || holderOf(x, e.src) !== self.me) return;
        x.triggered(self, "+20 gold.");
        x.gain(self.me, 20);
      },
    },
  },

  // Démineur : une chance sur deux de désactiver la carte ciblée, sinon le Démineur saute (défaussé) ;
  // dans tous les cas, ses voisines sont désactivées jusqu'à la fin du prochain tour du lanceur.
  "POL-10": {
    activate: (x, { id, me }) => {
      if (!pay(x, me)) return false;
      const pool = terrainCards(x, id);
      if (!pool.length) {
        x.reason = "Aucune carte à cibler sur les terrains.";
        return false;
      }
      // D'abord : ses voisines sont désactivées jusqu'à la fin du prochain tour du lanceur.
      const at = E.locate(x.g, id);
      const t = at?.zone === "terrain" ? x.p(at.uid).terrain : [];
      const near = at?.zone === "terrain" ? [t[at.index - 1], t[at.index + 1]].filter((v): v is string => !!v) : [];
      for (const v of near) if (E.locate(x.g, v)?.zone === "terrain") x.disable(v, x.untilEndOfNext(me));
      const c = pickCard(x, me, id, "Démineur : quelle carte ?", pool.filter((v) => E.locate(x.g, v)?.zone === "terrain"))!;
      if (!c) return;
      if (x.dice(me, 2) === 1) x.disable(c);
      else {
        x.log("💥 Le Démineur saute : il est défaussé.", { src: id });
        x.discard(id);
      }
    },
  },

  // GIGN : Trou de ver, désactive une carte de ton terrain jusqu'à la fin de ton prochain tour
  "POL-11": {
    activate: (x, { id, me }) => {
      if (!pay(x, me)) return false;
      const pool = x.p(me).terrain.filter((c) => c !== id);
      if (!pool.length) {
        x.reason = "Aucune autre carte sur ton terrain.";
        return false;
      }
      x.setBlackHole(me, T);
      const c = pickCard(x, me, id, "GIGN : quelle carte de ton terrain désactiver ?", pool)!;
      x.disable(c, x.untilEndOfNext(me));
    },
  },

  // RAID : Quasar ; le prochain joueur qui modifie une de tes ressources défausse sa main, puis le RAID est défaussé
  "POL-12": {
    activate: (x, { id, me }) => {
      if (isArmed(x, id)) {
        x.log("🚨 RAID déjà en place.");
        return;
      }
      if (!pay(x, me)) return false;
      x.setBlackHole(me, Q);
      arm(x, id);
      x.log("🚨 RAID en place : le prochain joueur qui touche à tes ressources défausse sa main.");
    },
    on: {
      interaction: (x, self, e) => {
        if (!isArmed(x, self.id) || e.target !== self.me || e.actor === self.me || !["gold", "sentience", "trou noir"].includes(e.what)) return;
        disarm(x, self.id);
        x.triggered(self, `${x.name(e.actor)} touche aux ressources de ${x.name(self.me)} : il défausse sa main.`);
        for (const c of [...x.p(e.actor).hand]) x.discard(c);
        x.discard(self.id);
      },
    },
  },

  // Compagnie d'Intervention : choisis la sentience de la cible
  "POL-13": {
    activate: (x, { id, me }) => {
      if (!pay(x, me)) return false;
      const u = x.choosePlayer(me, "Compagnie d'Intervention : quelle cible ?", x.turnOrder(), id)!;
      const v = x.chooseOption(me, `Sentience de ${x.name(u)} ?`, ["Vraie", "Fausse"], id) === 0;
      x.setSentience(u, v);
    },
  },

  // Brigade Équestre : Primordial et sentience vraie
  "POL-14": {
    activate: (x, { me }) => {
      if (!pay(x, me)) return false;
      x.setBlackHole(me, P);
      x.setSentience(me, true);
    },
  },

  // Contrôleur aux frontières : sentience fausse, désactive la première carte du voisin de droite et la
  // dernière du voisin de gauche jusqu'au début de ton prochain tour
  "POL-15": {
    activate: (x, { id, me }) => {
      if (!pay(x, me)) return false;
      const [left, right] = E.neighbours(x.g, me);
      if (left === me) {
        x.reason = "Il faut au moins un autre joueur.";
        return false;
      }
      x.setSentience(me, false);
      const targets = new Set([x.p(right).terrain[0], last(x.p(left).terrain)].filter((c): c is string => !!c && c !== id));
      if (!targets.size) x.log("Les terrains voisins sont vides.");
      for (const c of targets) x.disable(c, x.untilStartOfNext(me));
    },
  },

  // Enquêteur Immigration (passif) : Blazard en arrivant ; une carte qui arrive sur ton terrain sans venir de ta
  // main, de ta défausse ou de ta pioche est désactivée jusqu'à la fin de ton prochain tour et tu choisis sa place
  "POL-16": {
    activate: upkeep(B),
    on: {
      placed: (x, self, e) => {
        if (e.card === self.id || e.uid !== self.me) return;
        if (e.fromUid === self.me && e.fromZone && e.fromZone !== "terrain") return;
        x.triggered(self, `« ${card(e.card).name} » arrive d'ailleurs : contrôle.`);
        x.disable(e.card, x.untilEndOfNext(self.me));
        const at = E.locate(x.g, e.card);
        if (at?.zone !== "terrain") return;
        const slot = x.chooseSlot(self.me, `Où placer « ${card(e.card).name} » sur ton terrain ?`, self.me, e.card, self.id);
        if (slot !== at.index && slot !== at.index + 1) x.move(e.card, { uid: self.me, zone: "terrain", index: slot });
      },
    },
  },

  // Brigade Canine : sentience vraie, désactive une carte du joueur suivant et la Brigade jusqu'au début de son prochain tour
  "POL-17": {
    activate: (x, { id, me }) => {
      if (!pay(x, me)) return false;
      const next = E.neighbours(x.g, me)[1];
      const pool = next === me ? [] : x.p(next).terrain;
      if (!pool.length) {
        x.reason = "Le joueur suivant n'a aucune carte sur son terrain.";
        return false;
      }
      x.setSentience(me, true);
      const c = pickCard(x, me, id, `Brigade Canine : quelle carte de ${x.name(next)} ?`, pool)!;
      x.disable(c, x.untilStartOfNext(next));
      x.disable(id, x.untilStartOfNext(next));
    },
  },

  // Enquêteur Cybercriminalité : +20 gold, dé trou noir, sentience inversée
  "POL-18": {
    activate: (x, { me }) => {
      x.gain(me, 20);
      x.setBlackHole(me, x.bhDice(me));
      x.invertSentience(me);
    },
  },

  // Tireur d'élite : désactive une carte jusqu'à la fin de ton prochain tour
  "POL-19": {
    activate: (x, { id, me }) => {
      if (!pay(x, me)) return false;
      const pool = terrainCards(x, id);
      if (!pool.length) {
        x.reason = "Aucune carte à cibler sur les terrains.";
        return false;
      }
      const c = pickCard(x, me, id, "Tireur d'élite : quelle carte viser ?", pool)!;
      x.disable(c, x.untilEndOfNext(me));
    },
  },

  // Brigade Mécha : sentience fausse, défausse la première carte désactivée d'un joueur, puis se désactive
  "POL-20": {
    activate: (x, { id, me }) => {
      if (!pay(x, me)) return false;
      const pool = x.turnOrder().filter((u) => x.p(u).terrain.some((c) => c !== id && x.isDisabled(c)));
      if (!pool.length) {
        x.reason = "Aucune carte désactivée sur les terrains.";
        return false;
      }
      x.setSentience(me, false);
      const u = x.choosePlayer(me, "Brigade Mécha : quel joueur ?", pool, id)!;
      x.discard(x.p(u).terrain.find((c) => c !== id && x.isDisabled(c))!);
      x.disable(id, x.untilEndOfNext(me));
    },
  },

  // Compagnie des Blindés : fait reculer de 3 places une carte d'un voisin et la désactive jusqu'au début du tour de son joueur
  "POL-21": {
    guarded: true,
    activate: (x, { id, me }) => {
      if (!pay(x, me)) return false;
      const near = [...new Set(E.neighbours(x.g, me))].filter((u) => u !== me);
      const pool = near.flatMap((u) => x.p(u).terrain);
      if (!pool.length) {
        x.reason = "Les terrains de tes voisins sont vides.";
        return false;
      }
      const c = pickCard(x, me, id, "Compagnie des Blindés : quelle carte faire reculer ?", pool)!;
      const at = E.locate(x.g, c)!;
      const to = Math.min(at.index + 3, x.p(at.uid).terrain.length - 1);
      if (to !== at.index) x.move(c, { uid: at.uid, zone: "terrain", index: to + 1 });
      x.disable(c, x.untilStartOfNext(at.uid));
    },
  },

  // Casspir : appartient toujours à celui qui l'a posé ; au choix rien, se déplacer de 3 places au plus, ou
  // désactiver ses voisines et revenir dans la pioche
  "POL-22": {
    guarded: true,
    onMove: (x, self, from, to) => {
      if (to?.zone === "terrain" && from?.zone !== "terrain") x.take(self.id, x.current);
    },
    activate: (x, { id, me }) => {
      const owner = x.g.owner[id] ?? me;
      if (!pay(x, owner)) return false;
      const o = x.chooseOption(owner, "Casspir : que faire ?", ["Ne rien faire", "Se déplacer (3 places au plus)", "Désactiver ses voisines et revenir dans la pioche"], id);
      if (o === 0) {
        x.log("Casspir ne bouge pas.");
        return;
      }
      const at = E.locate(x.g, id)!;
      if (o === 1) {
        const d = x.chooseNumber(owner, "Déplacement (négatif = vers la gauche, positif = vers la droite)", -3, 3, id);
        const len = x.p(at.uid).terrain.length;
        const [left, right] = E.neighbours(x.g, at.uid);
        const to = at.index + d;
        if (d === 0) return;
        if (to < 0 && left !== at.uid) x.move(id, { uid: left, zone: "terrain" });
        else if (to >= len && right !== at.uid) x.move(id, { uid: right, zone: "terrain", index: 0 });
        else {
          const k = Math.max(0, Math.min(len - 1, to));
          x.move(id, {
            uid: at.uid,
            zone: "terrain",
            index: k > at.index ? k + 1 : k,
          });
        }
        return;
      }
      const t = x.p(at.uid).terrain;
      for (const c of [t[at.index - 1], t[at.index + 1]]) if (c) x.disable(c);
      x.move(id, { uid: owner, zone: "deck" });
      x.shuffleZone(owner, "deck");
    },
  },

  // Drone de surveillance (passif) : Primordial en arrivant ; désactive les cartes à la même place sur les terrains voisins
  "POL-23": {
    activate: upkeep(P),
  },

  // Transporteur de troupes : au choix rien, réorganiser ton terrain, ou poser une carte de ta main sans activer son effet
  "POL-24": {
    guarded: true,
    activate: (x, { id, me }) => {
      if (!pay(x, me)) return false;
      const o = x.chooseOption(me, "Transporteur de troupes : que faire ?", ["Ne rien faire", "Réorganiser ton terrain", "Poser une carte de ta main sans effet"], id);
      if (o === 0) {
        x.log("Le transporteur attend.");
        return;
      }
      if (o === 2 && !x.p(me).hand.length) {
        x.reason = "Ta main est vide.";
        return false;
      }
      if (o === 1) {
        const order = x.chooseOrder(me, "Nouvel ordre de ton terrain", [...x.p(me).terrain], id);
        x.p(me).terrain = order;
        x.log(`${x.name(me)} réorganise son terrain.`);
        x.interact(me, "terrain");
        return;
      }
      const c = x.chooseCard(me, "Quelle carte de ta main poser (sans activer son effet) ?", x.p(me).hand, id)!;
      const slot = x.chooseSlot(me, `Où poser « ${card(c).name} » ?`, me, c, id);
      x.move(c, { uid: me, zone: "terrain", index: slot }, { activate: false });
    },
  },

  // Fonctionnaire corrompu (passif) : en arrivant, tu peux défausser une carte de ton terrain pour +50 gold ;
  // +10 gold chaque fois que tu défausses une carte de ta main
  "POL-25": {
    // À chaque fois que la carte se joue : défausser (facultatif) une carte de son terrain pour +50 💰.
    activate: (x, { id, me }) => {
      const pool = x.p(me).terrain.filter((c) => c !== id);
      if (!pool.length) return;
      const [c] = x.chooseCards(me, "Fonctionnaire corrompu : défausser une carte de ton terrain pour +50 gold ? (facultatif)", pool, 0, 1, id);
      if (!c) return;
      x.log("💼 Pot-de-vin : +50 gold.", { src: id });
      x.discard(c);
      x.gain(me, 50);
    },
    on: {
      discard: (x, self, e) => {
        if (e.uid !== self.me) return;
        x.triggered(self, "+10 gold.");
        x.gain(self.me, 10);
      },
    },
  },
};
