// Victor — effets automatiques. Rejouer les effets des autres et poser ses cartes chez les adversaires.
// Parasite doré, Double jeu, Cacapulte et Piège à Gobelin agissent aussi dans runtime.ts (déplacements et activations).
// Les choix d'interprétation sont notés dans l'onglet « Interprétations » du tableau.
import { card } from "../data/cards";
import * as E from "../game/engine";
import type { CardScript, Ctx } from "./runtime";

function setMark(x: Ctx, id: string, v: string | null) {
  const m = { ...(x.g.marks ?? {}) };
  if (v === null) delete m[id];
  else m[id] = v;
  x.g.marks = m;
}

export const VICTOR: Record<string, CardScript> = {
  // Marathon : gagne de quoi égaler le plus riche, puis part (mélangé) dans la pioche du plus pauvre
  "VIC-01": {
    activate: (x, { id, me }) => {
      const top = Math.max(...x.order.map((u) => x.p(u).gold));
      // v0.23 : la moitié de l'écart (arrondie à l'inférieur).
      const diff = Math.floor((top - x.p(me).gold) / 2);
      if (diff > 0) x.gain(me, diff);
      else x.log("🏃 Tu es déjà le plus riche.");
      const poor = x.poorest(x.order)!;
      x.log(`🏃 Marathon part dans la pioche de ${x.name(poor)}, le plus pauvre.`, { to: poor });
      if (x.move(id, { uid: poor, zone: "deck" })) {
        x.take(id, poor);
        x.shuffleZone(poor, "deck");
      }
    },
  },

  // Stonks : pour 5 gold (facultatif), la prochaine carte qui se joue pour toi se joue deux fois
  "VIC-02": {
    activate: (x, { id, me }) => {
      if (!x.canPay(me, 5)) return false;
      if (x.chooseOption(me, "Stonks : payer 5 gold pour que ta prochaine carte se joue deux fois ?", ["Payer 5 gold", "Ne rien faire"], id) === 1) {
        return x.log("📈 Stonks : rien.");
      }
      x.spend(me, 5);
      setMark(x, id, me);
      x.log("📈 Stonks : ta prochaine carte se jouera deux fois.");
    },
    on: {
      activated: (x, self, e) => {
        if (x.g.marks?.[self.id] !== self.me || e.uid !== self.me || e.card === self.id) return;
        setMark(x, self.id, null);
        if (!x.active(e.card)) return x.log(`📈 Stonks : « ${card(e.card).name} » n'est plus sur un terrain, elle ne se rejoue pas.`, { src: self.id });
        x.triggered(self, `« ${card(e.card).name} » se joue une deuxième fois.`);
        x.activateCard(e.card, self.me);
      },
    },
  },

  // Echo : la première carte du terrain de chaque autre joueur qui a le même trou noir que toi se joue pour toi
  "VIC-03": {
    activate: (x, { id, me }) => {
      const bh = x.p(me).blackHole;
      const list = x.others(me).filter((u) => x.p(u).blackHole === bh);
      if (!list.length) {
        x.reason = "Aucun autre joueur n'a le même trou noir que toi.";
        return false;
      }
      let n = 0;
      for (const u of list) {
        const c = x.p(u).terrain[0];
        if (!c || c === id || !x.canActivate(c) || x.isDisabled(c)) {
          x.log(`🔊 ${x.name(u)} : pas de première carte à rejouer.`);
          continue;
        }
        x.activateCard(c, me);
        n++;
      }
      if (!n) {
        x.reason = "Aucune première carte avec un effet à rejouer.";
        return false;
      }
    },
  },

  // Marionnettes : une carte de la main d'un joueur (même trou noir) est mise de côté ; il doit la jouer à son tour,
  // puis elle va dans sa défausse
  "VIC-04": {
    activate: (x, { id, me }) => {
      const bh = x.p(me).blackHole;
      const pool = x.others(me).filter((u) => x.p(u).blackHole === bh && x.p(u).hand.length);
      const u = x.choosePlayer(me, "Marionnettes : quel joueur (même trou noir que toi) ?", pool, id);
      if (!u) {
        x.reason = "Aucun autre joueur avec le même trou noir n'a de carte en main.";
        return false;
      }
      const c = x.chooseCard(me, `Désigne à l'aveugle une carte de la main de ${x.name(u)}.`, x.p(u).hand, id, true);
      if (!c) return false;
      x.putUnder(c, id);
      setMark(x, c, `VIC-04:${u}`);
      x.log(`🎭 ${x.name(u)} met une carte de côté, face cachée : il devra la jouer à son prochain tour.`, { to: u });
    },
    on: {
      turnStart: (x, self, e) => {
        for (const c of [...(x.g.under?.[self.id] ?? [])]) {
          if (x.g.marks?.[c] !== `VIC-04:${e.uid}`) continue;
          setMark(x, c, null);
          x.triggered(self, `${x.name(e.uid)} doit jouer la carte mise de côté : « ${card(c).name} ».`);
          E.detachUnder(x.g, c, { uid: e.uid, zone: "terrain" });
          x.fx({ k: "move", card: c });
          x.placedActivate(c, e.uid);
          if (E.locate(x.g, c)?.zone === "terrain") x.runAs(c, e.uid, () => x.discard(c));
        }
      },
    },
  },

  // Vilain garnement : une carte piochée à l'aveugle dans la main d'un joueur joue son effet pour toi,
  // puis elle et cette carte vont dans la défausse de ce joueur
  "VIC-05": {
    activate: (x, { id, me }) => {
      const u = x.choosePlayer(me, "Vilain garnement : dans la main de qui piocher ?", x.others(me).filter((u) => x.p(u).hand.length), id);
      if (!u) {
        x.reason = "Aucun autre joueur n'a de carte en main.";
        return false;
      }
      const c = x.chooseCard(me, `Pioche à l'aveugle une carte de la main de ${x.name(u)}.`, x.p(u).hand, id, true);
      if (!c) return false;
      x.log(`😈 ${x.name(me)} pioche « ${card(c).name} » dans la main de ${x.name(u)}.`, { dst: c, to: u });
      if (!x.canActivate(c) || !x.moveExchange(c, { uid: me, zone: "terrain" }, { activate: me })) {
        x.log(`« ${card(c).name} » n'a pas d'effet à jouer.`);
      }
      if (E.locate(x.g, c)) x.moveExchange(c, { uid: u, zone: "discard" });
      if (x.moveExchange(id, { uid: u, zone: "discard" })) x.take(id, u);
    },
  },

  // Ruisselement : ton terrain (cette carte comprise) est mélangé et réparti dans les défausses de tous les joueurs ;
  // puis tu reprends, dans l'ordre du tour, la carte du dessus de la pioche de chaque autre joueur pour 2 gold chacune
  "VIC-06": {
    activate: (x, { me }) => {
      const mine = E.shuffle([...x.p(me).terrain]);
      const n = mine.length;
      const ring = [me, ...x.others(me)];
      x.log(`💧 Ruisselement : ${n} carte(s) du terrain de ${x.name(me)} sont réparties dans les défausses.`);
      mine.forEach((c, i) => {
        const u = ring[i % ring.length];
        if (x.move(c, { uid: u, zone: "discard" })) x.take(c, u);
      });
      const others = x.others(me);
      let got = 0;
      let k = 0;
      // Joueurs dont on ne peut plus rien prendre (pioche vide, ou carte du dessus qui ne peut pas bouger).
      const done = new Set<string>();
      while (got < n && x.p(me).gold >= 2 && done.size < others.length) {
        const u = others[k++ % others.length];
        if (done.has(u)) continue;
        const c = x.p(u).deck[0];
        // La carte est prise d'abord, puis payée : une carte qui ne peut pas bouger ne coûte rien
        // (sinon on payait sans fin pour la même carte).
        if (!c || !x.moveExchange(c, { uid: me, zone: "terrain" }, { activate: false })) {
          done.add(u);
          continue;
        }
        x.take(c, me);
        if (x.g.phase === "activation" && x.current === me) x.g.activated = [...(x.g.activated ?? []), c];
        got++;
        x.giveBack(me, u, 2);
      }
      x.log(`💧 Terrain reconstitué : ${got} carte(s) sur ${n}.`);
    },
  },

  // BezRoulette : 1d100 ; sur 100, une de tes conditions de victoire est validée pour ce tour
  "VIC-07": {
    activate: (x, { id, me }) => {
      if (x.dice(me, 100) !== 100) {
        x.reason = "Pas de 100 : rien ne se passe.";
        return false;
      }
      const team = E.teamKey(x.room, me);
      const p = x.p(me);
      const opts: ("personal" | "common")[] = [];
      if (p.personalVC && !p.personalDone) opts.push("personal");
      if (!x.g.commonDone.includes(team)) opts.push("common");
      if (!opts.length) {
        x.reason = "Tes conditions de victoire sont déjà remplies.";
        return false;
      }
      const labels = opts.map((o) => (o === "personal" ? `Personnelle : ${card(p.personalVC!).name}` : `Commune : ${card(x.g.commonVC).name}`));
      const k = opts[x.chooseOption(me, "BezRoulette : quelle condition valider pour ce tour ?", labels, id)];
      x.banner("🎰 BezRoulette : 100 !");
      x.g.tempVC = { uid: me, turnOf: x.current, common: k === "common" };
      if (k === "common") E.setCommonDone(x.room, x.g, team, true);
      else E.setPersonalDone(x.room, x.g, me, true);
    },
  },

  // À l'abordage ! : 1d6
  "VIC-08": {
    activate: (x, { id, me }) => {
      const v = x.dice(me, 6);
      if (v === 2) return x.log("🏴‍☠️ 2 : rien ne se passe.");
      if (v === 1) {
        const right = E.neighbours(x.g, me)[1];
        if (right === me) return x.log("🏴‍☠️ 1 : pas de voisin de droite.");
        const c = x.chooseCard(right, `À l'abordage : quelle carte du terrain de ${x.name(me)} prendre ?`, x.p(me).terrain, id);
        if (!c) return x.log(`🏴‍☠️ 1 : ${x.name(me)} n'a pas de carte sur son terrain.`);
        const u = x.choosePlayer(right, `Sur quel terrain placer « ${card(c).name} » ?`, x.turnOrder(), id)!;
        const slot = x.chooseSlot(right, `Où placer « ${card(c).name} » ?`, u, c, id);
        x.log(`🏴‍☠️ 1 : ${x.name(right)} déplace « ${card(c).name} ».`, { dst: c });
        x.move(c, { uid: u, zone: "terrain", index: slot });
        return;
      }
      const players = v === 6 ? x.others(me) : x.turnOrder();
      const pool = players.flatMap((u) => x.p(u).terrain).filter((c) => c !== id);
      const what = v === 3 ? "renvoyer dans la pioche de son joueur" : v === 6 ? "prendre sur ton terrain" : "défausser";
      const c = x.chooseCard(me, `À l'abordage (${v}) : quelle carte posée ${what} ?`, pool, id);
      if (!c) {
        x.reason = "Aucune carte posée à viser.";
        return false;
      }
      const holder = E.locate(x.g, c)!.uid;
      if (v === 3) {
        if (x.move(c, { uid: holder, zone: "deck" })) x.shuffleZone(holder, "deck");
      } else if (v <= 5) x.move(c, { uid: holder, zone: "discard" });
      else {
        const slot = x.chooseSlot(me, `Où placer « ${card(c).name} » ?`, me, c, id);
        if (x.move(c, { uid: me, zone: "terrain", index: slot })) x.take(c, me);
      }
    },
  },

  // Parasite doré : se glisse sous une carte d'un autre joueur ; quand elle s'active, son effet est pour toi (voir runtime)
  "VIC-09": {
    activate: (x, { id, me }) => {
      const pool = x.others(me).flatMap((u) => x.p(u).terrain);
      const host = x.chooseCard(me, "Parasite doré : sous quelle carte d'un autre joueur se cacher ?", pool, id);
      if (!host) {
        x.reason = "Aucune carte sur les terrains des autres joueurs.";
        return false;
      }
      setMark(x, id, me);
      x.putUnder(id, host);
      x.log(`🪱 Parasite doré se glisse sous « ${card(host).name} » : ses effets seront pour ${x.name(me)}.`, { dst: host });
    },
  },

  // Poêle à frire : tu peux reprendre une carte de ton terrain en main
  "VIC-10": {
    activate: (x, { id, me }) => {
      const c = x.chooseCards(me, "Poêle à frire : reprendre une carte de ton terrain en main ? (facultatif)", x.p(me).terrain, 0, 1, id)[0];
      if (!c) return x.log("🍳 Poêle à frire : rien.");
      x.move(c, { uid: me, zone: "hand" });
    },
  },

  // Collecteur d'impôts : jusqu'à ton prochain tour, +3 gold par carte posée depuis une main, −3 par carte défaussée au lieu d'être posée
  "VIC-11": {
    activate: (x, { id, me }) => {
      setMark(x, id, me);
      x.log("💼 Jusqu'à ton prochain tour : +3 gold par carte jouée, −3 gold par carte passée.");
    },
    on: {
      placed: (x, self, e) => {
        if (x.g.marks?.[self.id] !== self.me || e.src !== null || e.fromZone !== "hand" || e.card === self.id) return;
        x.triggered(self, `« ${card(e.card).name} » est jouée : +3 gold.`);
        x.gain(self.me, 3);
      },
      discard: (x, self, e) => {
        if (x.g.marks?.[self.id] !== self.me || e.src !== null) return;
        x.triggered(self, `${x.name(e.uid)} passe (il défausse une carte) : −3 gold.`);
        x.lose(self.me, 3);
      },
      turnStart: (x, self, e) => {
        if (e.uid !== self.me || x.g.marks?.[self.id] !== self.me) return;
        setMark(x, self.id, null);
        x.triggered(self, "ton tour revient : la carte est défaussée.");
        x.discard(self.id);
      },
    },
  },

  // Héritage : la première carte de ta pioche va à la fin du terrain d'un joueur, qui te paie 10 gold
  "VIC-12": {
    activate: (x, { id, me }) => {
      const c = x.p(me).deck[0];
      if (!c) {
        x.reason = "Ta pioche est vide.";
        return false;
      }
      const u = x.choosePlayer(me, "Héritage : quel joueur reçoit la première carte de ta pioche ?", x.others(me), id);
      if (!u) return false;
      if (!x.move(c, { uid: u, zone: "terrain" })) return false;
      x.giveBack(u, me, 10);
    },
  },

  // Double jeu (passif) : avec le trou noir Primordial, la première carte de ta pioche se cache sous chaque carte que tu poses
  // (elle est révélée et posée quand la carte du dessus quitte le terrain : voir runtime)
  "VIC-13": {
    on: {
      placed: (x, self, e) => {
        if (e.src !== null || e.fromUid !== self.me || e.fromZone !== "hand" || e.card === self.id) return;
        if (x.p(self.me).blackHole !== "Primordial") return;
        const c = x.p(self.me).deck[0];
        if (!c) return;
        x.triggered(self, `la première carte de ta pioche se cache sous « ${card(e.card).name} ».`);
        x.putUnder(c, e.card);
        setMark(x, c, "VIC-13");
      },
    },
  },

  // Fou du roi : pour 10 gold (facultatif), l'ordre du terrain d'un joueur est mélangé
  "VIC-14": {
    activate: (x, { id, me }) => {
      const list = x.turnOrder().filter((u) => x.p(u).terrain.length > 1);
      if (!list.length) {
        x.reason = "Aucun terrain avec au moins 2 cartes.";
        return false;
      }
      if (!x.canPay(me, 10)) return false;
      if (x.chooseOption(me, "Fou du roi : payer 10 gold pour mélanger un terrain ?", ["Payer 10 gold", "Ne rien faire"], id) === 1) {
        return x.log("🃏 Fou du roi : rien.");
      }
      const u = x.choosePlayer(me, "Quel terrain mélanger ?", list, id)!;
      x.spend(me, 10);
      if (!x.canReorder(u)) return false;
      x.p(u).terrain = E.shuffle([...x.p(u).terrain]);
      x.fx({ k: "shuffle", uid: u, zone: "terrain" });
      x.log(`🃏 Le terrain de ${x.name(u)} est mélangé.`, { to: u });
      x.interact(u, "terrain");
    },
  },

  // Jus de grenade : avec un joueur qui a les mêmes gold, sentience et trou noir, vos deux pioches sont mélangées et partagées
  "VIC-15": {
    activate: (x, { id, me }) => {
      const P = x.p(me);
      const twins = x.others(me).filter((u) => {
        const q = x.p(u);
        return q.gold === P.gold && q.sentience === P.sentience && q.blackHole === P.blackHole;
      });
      const u = x.choosePlayer(me, "Jus de grenade : avec quel joueur mélanger les pioches ?", twins, id);
      if (!u) {
        x.reason = "Aucun joueur n'a les mêmes gold, sentience et trou noir que toi.";
        return false;
      }
      if (x.shielded(u, true)) return false;
      const pool = E.shuffle([...P.deck, ...x.p(u).deck]);
      P.deck = pool.filter((_, i) => i % 2 === 0);
      x.p(u).deck = pool.filter((_, i) => i % 2 === 1);
      for (const c of P.deck) x.take(c, me);
      for (const c of x.p(u).deck) x.take(c, u);
      x.fx({ k: "shuffle", uid: me, zone: "deck" });
      x.fx({ k: "shuffle", uid: u, zone: "deck" });
      x.log(`🍹 ${x.name(me)} et ${x.name(u)} mélangent leurs pioches et les partagent (${P.deck.length} / ${x.p(u).deck.length}).`, { to: u });
      x.interact(u, "pioche");
      x.discard(id);
    },
  },

  // Voyant voyou voyeur (passif) : les cartes face cachée (sauf les mains) sont visibles (voir l'interface) ;
  // au début de son tour, un autre joueur peut te payer 50 gold pour la défausser
  "VIC-16": {
    on: {
      turnStart: (x, self, e) => {
        if (e.uid === self.me || x.p(e.uid).out || x.p(e.uid).gold < 50) return;
        const o = x.chooseOption(e.uid, `Voyant voyou voyeur : payer 50 gold à ${x.name(self.me)} pour défausser la carte ?`, ["Non", "Payer 50 gold"], self.id);
        if (o === 0) return;
        x.runAs(self.id, e.uid, () => {
          x.giveBack(e.uid, self.me, 50);
          x.discard(self.id);
        });
      },
    },
  },

  // Cacapulte (passif) : géré dans runtime (une carte qui doit aller dans ta défausse peut aller dans celle d'un autre)
  "VIC-17": {},

  // Capsule de sauvetage : choisis ton trou noir, puis cette carte va dans la défausse d'un autre joueur
  "VIC-18": {
    activate: (x, { id, me }) => {
      x.setBlackHole(me, x.chooseBlackHole(me, "Capsule de sauvetage : ton nouveau trou noir ?", undefined, id));
      const u = x.choosePlayer(me, "Dans la défausse de quel joueur envoyer la capsule ?", x.others(me), id);
      if (u && x.move(id, { uid: u, zone: "discard" })) x.take(id, u);
    },
  },

  // Piège à Gobelin (passif) : géré dans runtime (un autre joueur qui modifie ton terrain est arrêté et paie 50 gold)
  "VIC-19": {},

  // ✨ Ajoutée par Claude (v0.23) — Girouette : choisis ton trou noir, puis la carte va à la fin du terrain d'un autre joueur
  "VIC-20": {
    activate: (x, { id, me }) => {
      x.setBlackHole(me, x.chooseBlackHole(me, "Girouette : ton nouveau trou noir ?", x.p(me).blackHole, id));
      const u = x.choosePlayer(me, "Girouette : sur le terrain de quel joueur la poser ?", x.others(me), id);
      if (u) x.move(id, { uid: u, zone: "terrain" }, { activate: false });
    },
  },

  // ✨ Ajoutée par Claude (v0.23) — Miroir : inverse ta sentience, puis la carte va dans la défausse d'un autre joueur
  "VIC-21": {
    activate: (x, { id, me }) => {
      x.invertSentience(me);
      const u = x.choosePlayer(me, "Miroir : dans la défausse de quel joueur l'envoyer ?", x.others(me), id);
      if (u && x.move(id, { uid: u, zone: "discard" })) x.take(id, u);
    },
  },
};
