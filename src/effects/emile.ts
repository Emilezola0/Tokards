// Emile — effets automatiques. Positions, dés et copies d'effets.
// Les choix d'interprétation sont notés dans la colonne « Précisions » du tableau.
import { card } from "../data/cards";
import * as E from "../game/engine";
import type { BlackHole } from "../game/types";
import type { CardScript, Ctx, Self } from "./runtime";

const P: BlackHole = "Primordial";
const Q: BlackHole = "Quasar";
const B: BlackHole = "Blazard";
const T: BlackHole = "Trou de ver";
const tags = (id: string) => E.tagsOf(E.live.g, id);
const isGold = (id: string) => tags(id).gold;
const isSent = (id: string) => tags(id).sentience;
const isBH = (id: string) => tags(id).blackHole;

const isArmed = (x: Ctx, id: string) => (x.g.armed ?? []).includes(id);
const arm = (x: Ctx, id: string) => !isArmed(x, id) && (x.g.armed = [...(x.g.armed ?? []), id]);
const disarm = (x: Ctx, id: string) => (x.g.armed = (x.g.armed ?? []).filter((c) => c !== id));
const setMark = (x: Ctx, id: string, v: string | null) => {
  const m = { ...(x.g.marks ?? {}) };
  if (v == null) delete m[id];
  else m[id] = v;
  x.g.marks = m;
};
const store = (x: Ctx, id: string) => x.g.cardStore?.[id] ?? 0;
const setStore = (x: Ctx, id: string, n: number) => {
  const s = { ...(x.g.cardStore ?? {}) };
  if (n) s[id] = n;
  else delete s[id];
  x.g.cardStore = s;
};
/** Cartes jouables d'un terrain (effet automatique, non désactivées). */
const playable = (x: Ctx, list: string[]) => list.filter((c) => x.canActivate(c) && !x.isDisabled(c));
const allTerrains = (x: Ctx) => x.allTerrainCards();
/** Ramène une carte sur le terrain de `me` (où qu'elle soit) sans activer son effet. */
function bring(x: Ctx, me: string, id: string) {
  const at = E.locate(x.g, id);
  if (!at) return x.log(`« ${card(id).name} » n'est plus en jeu.`);
  if (at.zone === "terrain" && at.uid === me) return x.log(`« ${card(id).name} » est déjà sur ton terrain.`);
  if (x.move(id, { uid: me, zone: "terrain" }, { activate: false })) x.take(id, me);
}
/** Valeur provisoire (Disconnect) : retirée à la fin du tour. */
function provisional(x: Ctx, uid: string, kind: "bh" | "sent", prev: string) {
  if ((x.g.temp ?? []).some((t) => t.uid === uid && t.kind === kind)) return;
  x.g.temp = [...(x.g.temp ?? []), { uid, kind, prev }];
}

/** Thomas le train : gagne sa position (1, 2, 3…) puis se décale d'une place vers la droite. */
function thomas(x: Ctx, self: Self, why: string) {
  x.once(`thomas:${self.id}`, () => {
    const at = E.locate(x.g, self.id);
    if (at?.zone !== "terrain") return;
    x.triggered(self, `${why} : +${at.index + 1} gold (sa position).`);
    x.gain(at.uid, at.index + 1);
    if (at.index < x.p(at.uid).terrain.length - 1) x.move(self.id, { uid: at.uid, zone: "terrain", index: at.index + 2 });
  });
}

/** Domonique Sun : part, face visible, dans la main d'un joueur en Trou de ver. */
function sendSun(x: Ctx, self: Self) {
  const pool = x.others(self.me).filter((u) => x.p(u).blackHole === T);
  if (!pool.length) {
    x.reason = "Aucun autre joueur n'est en Trou de ver.";
    return false;
  }
  const u = x.random(pool);
  x.triggered(self, `${x.name(u)} est en Trou de ver : la carte part dans sa main, face visible.`);
  if (!x.move(self.id, { uid: u, zone: "hand" })) return;
  x.g.revealed = [...(x.g.revealed ?? []), self.id];
  x.noteOrigin("revealed", self.id);
  setMark(x, self.id, self.me);
}

/** Sanglier : « manger » = +5 gold par carte 💰 sur tous les terrains, puis il va à la défausse. */
function eat(x: Ctx, id: string, me: string) {
  disarm(x, id);
  const n = allTerrains(x).filter(isGold).length;
  x.log(`🐗 Le sanglier mange : ${n} carte(s) 💰 sur les terrains.`);
  if (n) x.gain(me, 5 * n);
  x.discard(id);
}

export const EMILE: Record<string, CardScript> = {
  // Gueux : parmi les 3 dernières cartes → 2 gold par joueur, sinon 1
  "EMI-01": {
    activate: (x, { id, me }) => {
      const t = x.p(me).terrain;
      const lastThree = t.indexOf(id) >= t.length - 3;
      x.log(lastThree ? "Le Gueux est parmi les 3 dernières cartes." : "Le Gueux n'est pas parmi les 3 dernières cartes.");
      x.gain(me, (lastThree ? 2 : 1) * x.others(me).length);
    },
  },

  // Voleur de Sentience : vole une carte 🧠, joue son effet pour toi ; la victime joue l'effet d'une de ses cartes 🧠 restantes
  "EMI-02": {
    activate: (x, { id, me }) => {
      const pool = x.others(me).flatMap((u) => x.p(u).terrain).filter(isSent);
      const c = x.chooseCard(me, "Quelle carte 🧠 voler ?", pool, id);
      if (!c) {
        x.reason = "Aucun adversaire n'a de carte 🧠 sur son terrain.";
        return false;
      }
      const victim = E.locate(x.g, c)!.uid;
      if (!x.move(c, { uid: me, zone: "terrain" })) return false;
      x.take(c, me);
      if (x.canActivate(c)) x.activateCard(c, me);
      const back = playable(x, x.p(victim).terrain.filter(isSent));
      const v = x.chooseCard(me, `Quelle carte 🧠 de ${x.name(victim)} joue son effet pour lui ?`, back, id);
      if (v) x.activateCard(v, victim);
    },
  },

  // Obélisque de la vérité : 1d6 ; sur 1 elle part chez le plus pauvre, sinon tu changes une ressource (toi ou un allié)
  "EMI-03": {
    activate: (x, { id, me }) => {
      if (x.dice(me, 6) === 1) {
        const poor = x.poorest(x.order)!;
        if (poor === me) return x.log("Tu es le plus pauvre : l'obélisque reste chez toi.");
        x.log(`L'obélisque part chez le plus pauvre, ${x.name(poor)}.`);
        x.move(id, { uid: poor, zone: "terrain" });
        return;
      }
      const u = x.choosePlayer(me, "Obélisque : la ressource de qui changer ?", x.team(me), id)!;
      const o = x.chooseOption(me, `Quelle ressource de ${x.name(u)} ?`, ["🧠 Inverser la sentience", "💰 Gold (−20 à +20)", "🌀 Changer le trou noir"], id);
      if (o === 0) x.invertSentience(u);
      else if (o === 1) {
        const n = x.chooseNumber(me, `Gold de ${x.name(u)} : combien ?`, -20, 20, id);
        if (n > 0) x.gain(u, n);
        else if (n < 0) x.lose(u, -n);
      } else x.setBlackHole(u, x.chooseBlackHole(me, `Nouveau trou noir de ${x.name(u)} ?`, x.p(u).blackHole, id));
    },
  },

  // Thomas le train (passif)
  "EMI-04": {
    on: {
      placed: (x, self, e) => {
        if (e.uid === self.me) thomas(x, self, e.card === self.id ? "il arrive sur le terrain" : "une carte est ajoutée");
      },
    },
    onMove: (x, self, from, to) => {
      if (from?.zone === "terrain" && to?.zone === "terrain") thomas(x, self, "sa position change");
    },
  },

  // Obelix : 30 % → Obélisque de la vérité et sentience vraie ; 70 % → Sanglier chasseur d'or et sentience fausse
  "EMI-05": {
    activate: (x, { me }) => {
      if (x.dice(me, 10) <= 3) {
        x.log("Obelix ramène l'Obélisque de la vérité.");
        bring(x, me, "EMI-03");
        x.setSentience(me, true);
      } else {
        x.log("Obelix ramène le Sanglier chasseur d'or.");
        bring(x, me, "EMI-06");
        x.setSentience(me, false);
      }
    },
  },

  // Sanglier chasseur d'or
  "EMI-06": {
    activate: (x, { id, me }) => {
      if (isArmed(x, id)) return eat(x, id, me);
      if (x.p(me).sentience) {
        const rich = x.richest(x.order)!;
        const golds = x.p(rich).terrain.filter((c) => c !== id && isGold(c));
        x.log(`Le plus riche, ${x.name(rich)}, lance un dé pour ${golds.length} carte(s) 💰 (1 chance sur 5 de la perdre).`);
        for (const c of golds) if (x.dice(rich, 5) === 1) x.discard(c);
        x.discard(id);
        return;
      }
      if (x.active("EMI-05", me)) return eat(x, id, me);
      arm(x, id);
      x.log("🐗 Le sanglier mangera au prochain tour.");
    },
  },

  // Bluebeu Skefeu : Primordial ; avec 2 cartes 🧠 chez toi et 3 cartes 💰 sur les terrains, tu poses jusqu'à 3 cartes ce tour
  "EMI-07": {
    activate: (x, { me }) => {
      x.setBlackHole(me, P);
      const s = x.p(me).terrain.filter(isSent).length;
      const g = allTerrains(x).filter(isGold).length;
      if (s < 2 || g < 3) return x.log(`Pas de pose multiple : 🧠 ${s}/2 sur ton terrain, 💰 ${g}/3 sur les terrains.`);
      if (me !== x.current) return x.log("Ce n'est pas ton tour : pas de pose multiple.");
      if (x.g.phase === "activation") x.g.actionsLeft = Math.max(x.g.actionsLeft, 3);
      else {
        E.grantExtraAction(x.room, x.g);
        E.grantExtraAction(x.room, x.g);
      }
      x.log("🃏 Tu peux poser jusqu'à 3 cartes ce tour : leurs effets se jouent dans l'ordre de pose.");
    },
  },

  // Poromarix (passif)
  "EMI-08": {
    on: {
      turnStart: (x, self, e) => {
        const owner = x.g.owner[self.id] ?? self.me;
        if (e.uid === self.me && self.me !== owner && x.p(self.me).sentience) {
          const v = x.dice(self.me, 6);
          setStore(x, self.id, store(x, self.id) + v);
          x.triggered(self, `il chasse ${v} gold pour ${x.name(owner)} (${store(x, self.id)} en réserve).`);
        }
        if (e.uid !== owner || !x.p(owner)) return;
        if (self.me === owner && store(x, self.id)) {
          x.triggered(self, `il rapporte ${store(x, self.id)} gold.`);
          x.gain(owner, store(x, self.id));
          setStore(x, self.id, 0);
        }
        if (x.chooseOption(owner, "Poromarix : le repositionner ?", ["Le laisser", "Le déplacer"], self.id) === 0) return;
        const u = x.choosePlayer(owner, "Sur quel terrain ?", x.turnOrder(), self.id)!;
        const slot = x.chooseSlot(owner, "À quelle place ?", u, self.id, self.id);
        x.move(self.id, { uid: u, zone: "terrain", index: slot });
      },
    },
    onMove: (x, self, from, to) => {
      const owner = x.g.owner[self.id];
      const n = store(x, self.id);
      if (!n || !owner) return;
      if (to?.zone === "terrain" && to.uid === owner) {
        x.triggered(self, `de retour chez ${x.name(owner)} : +${n} gold.`);
        x.gain(owner, n);
        setStore(x, self.id, 0);
      } else if (from?.zone === "terrain" && to?.zone === "discard") {
        const who = x.mover && x.p(x.mover) ? x.mover : to.uid;
        x.triggered(self, `défaussé : ${x.name(who)} encaisse ${n} gold.`);
        x.gain(who, n);
        setStore(x, self.id, 0);
      }
    },
  },

  // Domonique Sun (passif)
  "EMI-09": {
    inHand: true,
    noPlay: (g, id) => (g.revealed?.includes(id) ? "Domonique Sun est face visible : elle partira quand ton trou noir sera Primordial." : null),
    activate: (x, self) => sendSun(x, self),
    on: {
      placed: (x, self, e) => {
        const at = E.locate(x.g, self.id);
        if (at?.zone !== "hand" || e.src !== null || e.card === self.id || x.current !== self.me || !x.p(self.me).sentience) return;
        const sender = x.g.marks?.[self.id];
        if (!sender || sender === self.me || !x.p(sender)) return;
        x.triggered(self, `${x.name(self.me)} pose une carte : 2 gold pour ${x.name(sender)}.`);
        x.transfer(self.me, sender, 2);
      },
      blackHole: (x, self, e) => {
        if (e.uid !== self.me || e.to !== P || E.locate(x.g, self.id)?.zone !== "hand") return;
        x.triggered(self, "trou noir Primordial : la carte est défaussée.");
        setMark(x, self.id, null);
        x.discard(self.id);
      },
    },
  },

  // Tung Tung Tung Sahur : selon ton trou noir
  "EMI-10": {
    activate: (x, { me }) => {
      const bh = x.p(me).blackHole;
      if (bh === Q) {
        const right = E.neighbours(x.g, me)[1];
        if (right === me) return false;
        x.log(`Quasar : aspire les gold de ${x.name(right)}.`);
        x.transfer(right, me, x.p(right).gold);
      } else if (bh === P) {
        x.log("Primordial : tu perds tous tes gold.");
        x.lose(me, x.p(me).gold);
      } else if (bh === T) {
        x.g.aspire = { uid: me, until: E.pos(x.g) + 2 };
        x.log("🌪 Trou de ver : pendant 3 tours (celui-ci compris), tous les gold gagnés par les autres sont aspirés par toi.");
      } else {
        const all = x.order;
        const total = all.reduce((a, u) => a + Math.max(0, x.p(u).gold), 0);
        const each = Math.floor(total / all.length);
        x.log(`Blazard : l'argent est égalisé à ${each} gold chacun${total - each * all.length ? ` (le reste, ${total - each * all.length}, revient au lanceur)` : ""}.`);
        for (const u of all) {
          const want = each + (u === me ? total - each * all.length : 0);
          const d = want - x.p(u).gold;
          if (d < 0) x.lose(u, -d);
        }
        for (const u of all) {
          const want = each + (u === me ? total - each * all.length : 0);
          const d = want - x.p(u).gold;
          if (d > 0) {
            x.p(u).gold += d;
            x.fx({ k: "gold", uid: u, delta: d });
            x.log(`${x.name(u)} reçoit ${d} gold (${x.p(u).gold}).`, { to: u });
          }
        }
      }
    },
  },

  // Crocodilo Bombardino
  "EMI-11": {
    activate: (x, { id, me }) => {
      if (isArmed(x, id)) {
        disarm(x, id);
        const holder = E.locate(x.g, id)!.uid;
        x.log(`💥 Crocodilo Bombardino explose : tout le terrain de ${x.name(holder)} part à la défausse.`);
        x.banner(`💥 Crocodilo Bombardino explose chez ${x.name(holder)}`);
        for (const c of [...x.p(holder).terrain]) x.discard(c);
        return;
      }
      if (x.p(me).sentience) {
        arm(x, id);
        x.log("💣 Crocodilo Bombardino explosera au prochain tour.");
        return;
      }
      let missing = 5;
      for (const u of x.others(me)) {
        if (missing <= 0) break;
        const max = Math.min(missing, Math.max(0, x.p(u).gold));
        if (max <= 0) continue;
        const n = x.chooseNumber(u, `Crocodilo : donner des gold à ${x.name(me)} pour qu'il reste ? (il manque ${missing})`, 0, max, id);
        if (n > 0) missing -= x.giveBack(u, me, n);
      }
      if (missing <= 0) return x.log("Crocodilo reste en place : 5 gold reçus.");
      const to = x.random(x.others(me));
      if (!to) return;
      x.log(`Crocodilo n'a pas reçu ses 5 gold : il part chez ${x.name(to)}.`);
      x.move(id, { uid: to, zone: "terrain" });
    },
  },

  // Oolong Johnson
  "EMI-12": {
    activate: (x, { me }) => {
      if (!x.p(me).sentience) {
        const n = allTerrains(x).filter(isGold).length;
        x.log(`Sentience fausse : −1 gold par carte 💰 sur les terrains (${n}).`);
        x.lose(me, n);
        return;
      }
      let earned = 0;
      for (const u of x.turnOrder()) {
        const n = x.p(u).terrain.filter(isGold).length;
        if (!n) continue;
        earned += u === me ? x.gain(me, n) : x.transfer(u, me, n);
      }
      if (earned && x.active("EMI-13", me)) {
        x.log("📺 ADS est sur ton terrain : revenus doublés.");
        x.gain(me, earned);
      }
    },
  },

  // ADS : ton argent double, tes coûts aussi ; la carte qui suit ADS ne se joue pas ; Primordial → pour tout le monde
  "EMI-13": {
    activate: (x, { id, me }) => {
      const all = x.p(me).blackHole === P;
      for (const u of all ? x.turnOrder() : [me]) if (x.p(u).gold > 0) x.gain(u, x.p(u).gold);
      setMark(x, id, all ? "all" : null);
      x.log(all ? "📺 ADS (Primordial) : l'argent et les coûts de tout le monde sont doublés." : "📺 ADS : ton argent et tes coûts sont doublés.");
    },
  },

  // Disconnect : selon ton trou noir
  "EMI-14": {
    activate: (x, { id, me }) => {
      const bh = x.p(me).blackHole;
      if (bh === Q) {
        const to = x.chooseBlackHole(me, "Trou noir provisoire (jusqu'à la fin de ton tour) ?", undefined, id);
        provisional(x, me, "bh", bh);
        x.setBlackHole(me, to);
      } else if (bh === B) {
        const v = x.chooseOption(me, "Sentience provisoire (jusqu'à la fin de ton tour) ?", ["Vraie", "Fausse"], id) === 0;
        provisional(x, me, "sent", String(x.p(me).sentience));
        x.setSentience(me, v);
      } else if (bh === T) {
        const c = x.chooseCard(me, "Quelle carte ne fonctionnera pas ce tour ?", allTerrains(x).filter((c) => c !== id), id);
        if (!c) return false;
        x.disable(c, x.untilEndOfTurn());
      } else {
        for (const u of x.turnOrder()) {
          const pool = allTerrains(x).filter((c) => !x.isDisabled(c));
          const c = x.chooseCard(u, `${x.name(u)} : quelle carte ne fonctionnera pas ce tour ?`, pool, id);
          if (c) x.disable(c, x.untilEndOfTurn());
        }
      }
    },
  },

  // Thommage : 1d6 ; 6 → le joueur suivant passe son tour, 1 → tu passes ton prochain tour
  "EMI-15": {
    activate: (x, { me }) => {
      const v = x.dice(me, 6);
      if (v === 6) {
        const next = E.neighbours(x.g, me)[1];
        x.p(next).skipNext = true;
        x.log(`⏭ ${x.name(next)} passera son prochain tour.`);
      } else if (v === 1) {
        x.p(me).skipNext = true;
        x.log(`⏭ ${x.name(me)} passera son prochain tour.`);
      } else x.log("Rien ne se passe.");
    },
  },

  // Octogone : 50 gold pour changer de trou noir, puis une chance sur deux de rejouer la carte
  "EMI-16": {
    activate: (x, { id, me }) => {
      if (!x.spend(me, 50)) return false;
      x.setBlackHole(me, x.chooseBlackHole(me, "Octogone : nouveau trou noir ?", x.p(me).blackHole, id));
      if (x.dice(me, 2) === 1 && x.canPay(me, 50) && x.confirm(me, "Octogone : rejouer la carte (50 gold) ?", id)) x.activateCard(id, me);
    },
  },

  // Goredrinker : vole 2 gold par carte 🧠 de ton terrain ; deux voisines 🧠 → nouveau trou noir
  "EMI-17": {
    activate: (x, { id, me }) => {
      const t = x.p(me).terrain;
      const n = t.filter(isSent).length;
      const u = x.choosePlayer(me, `Goredrinker : à qui voler ${2 * n} gold ?`, x.others(me), id);
      if (!u) return false;
      if (n) x.transfer(u, me, 2 * n);
      const i = t.indexOf(id);
      if (t[i - 1] && t[i + 1] && isSent(t[i - 1]) && isSent(t[i + 1]))
        x.setBlackHole(me, x.chooseBlackHole(me, "Deux 🧠 autour de Goredrinker : nouveau trou noir ?", x.p(me).blackHole, id));
    },
  },

  // Transformers : une carte gagne le tag 🧠 jusqu'à la fin du tour
  "EMI-18": {
    activate: (x, { id, me }) => {
      const pool = allTerrains(x).filter((c) => !isSent(c));
      const c = x.chooseCard(me, "Transformers : quelle carte reçoit le tag 🧠 ?", pool, id);
      if (!c) {
        x.reason = "Toutes les cartes des terrains ont déjà le tag 🧠.";
        return false;
      }
      x.g.tempTags = [...(x.g.tempTags ?? []), c];
      x.noteOrigin("tag", c);
      x.log(`🤖 « ${card(c).name} » a le tag 🧠 jusqu'à la fin du tour.`, {
        dst: c,
      });
    },
  },

  // Origine rotatif : les premières cartes de chaque terrain tournent dans le sens du tour
  "EMI-19": {
    activate: (x) => {
      const o = x.order;
      const firsts = o.map((u) => x.p(u).terrain[0]);
      if (firsts.filter(Boolean).length < 1 || o.length < 2) return false;
      o.forEach((_, i) => {
        const c = firsts[i];
        if (c && E.locate(x.g, c)?.zone === "terrain")
          x.moveExchange(c, {
            uid: o[(i + 1) % o.length],
            zone: "terrain",
            index: 0,
          });
      });
      x.log("🔄 Les premières cartes tournent d'un terrain dans le sens du tour.");
    },
  },

  // Gravité grave : tant qu'elle est sur ton terrain, chaque gain de gold te rapporte 1 gold de plus (géré par le moteur)
  "EMI-20": {
    activate: (x) => void x.log("🌍 Gravité grave : chaque gain de gold rapporte 1 gold de plus à son joueur tant qu'elle est sur son terrain."),
  },

  // Souffle : sentience vraie → réorganise ton terrain
  "EMI-21": {
    activate: (x, { id, me }) => {
      if (!x.p(me).sentience) {
        x.reason = "Ta sentience est fausse.";
        return false;
      }
      const order = x.chooseOrder(me, "Souffle : nouvel ordre de ton terrain", [...x.p(me).terrain], id);
      x.p(me).terrain = order;
      x.log(`${x.name(me)} réorganise son terrain.`);
      x.interact(me, "terrain");
    },
  },

  // Ornithorynque : sentience vraie → 1d4 (Quasar, Blazard, Trou de ver, Primordial) ; fausse → devient vraie
  "EMI-22": {
    activate: (x, { me }) => {
      if (!x.p(me).sentience) return void x.setSentience(me, true);
      x.setBlackHole(me, [Q, B, T, P][x.dice(me, 4) - 1]);
    },
  },

  // Turbo pas broken : pile ou face, 2 gold par carte 🧠 ou par carte 🌀 de ton terrain
  "EMI-23": {
    activate: (x, { me }) => {
      const sent = x.dice(me, 2) === 1;
      const n = x.p(me).terrain.filter(sent ? isSent : isBH).length;
      x.log(`Turbo : ${sent ? "les cartes 🧠" : "les cartes 🌀"} rapportent (${n}).`);
      for (let i = 0; i < n; i++) x.gain(me, 2);
    },
  },

  // Ding Dong : copie l'effet d'une carte de son terrain qui a exactement les mêmes tags
  "EMI-24": {
    activate: (x, { id, me }) => {
      const t0 = tags(id);
      const same = (c: string) => {
        const t = tags(c);
        return t.sentience === t0.sentience && t.gold === t0.gold && t.blackHole === t0.blackHole;
      };
      const holder = E.locate(x.g, id)?.uid ?? me;
      const pool = playable(x, x.p(holder).terrain.filter((c) => c !== id && same(c)));
      const c = x.chooseCard(me, "Ding Dong : quel effet copier ?", pool, id);
      if (!c) {
        x.reason = "Aucune carte de ce terrain n'a les mêmes tags (🧠💰🌀).";
        return false;
      }
      x.activateCard(c, me);
    },
  },

  // Garlic : pour 5 gold, reprends une carte d'un terrain dans ta main
  "EMI-25": {
    activate: (x, { id, me }) => {
      if (!x.canPay(me, 5)) return false;
      const [c] = x.chooseCards(
        me,
        "Garlic : reprendre une carte d'un terrain dans ta main pour 5 gold ? (facultatif)",
        x.p(me).terrain.filter((c) => c !== id),
        0,
        1,
        id,
      );
      if (!c) return x.log("Garlic : aucune carte reprise.");
      if (!x.spend(me, 5)) return false;
      if (x.move(c, { uid: me, zone: "hand" })) x.take(c, me);
    },
  },

  // Gratin Dauphinois : sentience fausse → inverse l'ordre d'un terrain ; vraie → 50 % de changer le trou noir d'un adversaire
  "EMI-26": {
    activate: (x, { id, me }) => {
      if (!x.p(me).sentience) {
        const u = x.choosePlayer(me, "Gratin : quel terrain inverser ?", x.turnOrder().filter((u) => x.p(u).terrain.length > 1), id);
        if (!u || !x.canReorder(u)) return false;
        x.p(u).terrain.reverse();
        x.log(`🔃 Le terrain de ${x.name(u)} est inversé.`, { to: u });
        x.interact(u, "terrain");
        return;
      }
      const u = x.choosePlayer(me, "Gratin : quel adversaire ?", x.others(me), id);
      if (!u) return false;
      if (x.dice(me, 2) === 1) x.setBlackHole(u, x.chooseBlackHole(me, `Nouveau trou noir de ${x.name(u)} ?`, x.p(u).blackHole, id));
      else x.log("Raté : le trou noir ne change pas.");
    },
  },

  // Premier d'abord : se met en première position ; si elle l'est déjà, joue l'effet de la carte juste après
  "EMI-27": {
    activate: (x, { id, me }) => {
      const at = E.locate(x.g, id)!;
      if (at.index > 0) return void x.move(id, { uid: at.uid, zone: "terrain", index: 0 });
      const next = x.p(at.uid).terrain[1];
      if (!next || !playable(x, [next]).length) {
        x.reason = "Pas de carte juste après avec un effet à jouer.";
        return false;
      }
      x.activateCard(next, me);
    },
  },

  // Dernière d'abord : se met en dernière position ; si elle l'est déjà, rejoue l'effet de la carte juste avant
  "EMI-28": {
    activate: (x, { id, me }) => {
      const at = E.locate(x.g, id)!;
      const t = x.p(at.uid).terrain;
      if (at.index < t.length - 1) return void x.move(id, { uid: at.uid, zone: "terrain" });
      const prev = t[at.index - 1];
      if (!prev || !playable(x, [prev]).length) {
        x.reason = "Pas de carte juste avant avec un effet à jouer.";
        return false;
      }
      x.activateCard(prev, me);
    },
  },

  // Dash : Primordial → va chez le joueur suivant et lui vole la carte à la même position
  "EMI-29": {
    activate: (x, { id, me }) => {
      if (x.p(me).blackHole !== P) {
        x.reason = "Ton trou noir n'est pas Primordial.";
        return false;
      }
      const at = E.locate(x.g, id)!;
      const next = E.neighbours(x.g, me)[1];
      const c = next === me ? undefined : x.p(next).terrain[at.index];
      if (!c) {
        x.reason = `${x.name(next)} n'a pas de carte en position ${at.index + 1}.`;
        return false;
      }
      const from = E.locate(x.g, c)!;
      x.move(c, { uid: me, zone: "terrain" }, { activate: false });
      if (E.locate(x.g, c)?.uid !== me) return;
      x.take(c, me);
      x.emit({
        type: "steal",
        thief: me,
        victim: next,
        card: c,
        src: id,
        from,
      });
    },
  },

  // Goudron : en Trou de ver, tes autres cartes ne peuvent plus être déplacées ni volées (géré par le moteur)
  "EMI-30": {
    activate: (x, { id, me }) => {
      if (x.p(me).blackHole !== T) {
        disarm(x, id);
        x.reason = "Ton trou noir n'est pas Trou de ver.";
        return false;
      }
      arm(x, id);
      x.log("🛢 Goudron : tes autres cartes sont fixées tant que Goudron reste sur ton terrain.");
    },
  },

  // Odibidon : hors Trou de ver, rend les gold perdus pendant ce tour
  "EMI-31": {
    activate: (x, { me }) => {
      if (x.p(me).blackHole === T) {
        x.reason = "Ton trou noir est Trou de ver.";
        return false;
      }
      const n = me === x.current ? E.st(x.p(me)).lostTurn ?? 0 : 0;
      if (!n) return x.log("Aucun gold perdu ce tour.");
      x.gain(me, n);
    },
  },

  // Ok comme trade (passif) : en arrivant, propose un échange ; celui qui la reçoit peut jouer l'effet d'une de ses cartes
  "EMI-32": {
    on: {
      placed: (x, self, e) => {
        if (e.card !== self.id) return;
        const pool = x.others(self.me).filter((u) => x.p(u).terrain.length);
        if (!pool.length) return;
        const i = x.chooseOption(self.me, "Ok comme trade : proposer l'échange ? (facultatif)", ["Ne pas proposer", ...pool.map((u) => x.name(u))], self.id);
        if (!i) return x.log("Ok comme trade : aucune proposition.");
        const u = pool[i - 1];
        if (!x.confirm(u, `${x.name(self.me)} te propose « Ok comme trade » contre une carte de ton terrain. Accepter ?`, self.id)) return x.log(`${x.name(u)} refuse l'échange.`);
        const c = x.chooseCard(u, "Quelle carte de ton terrain donner ?", x.p(u).terrain, self.id)!;
        x.swap(self.id, c);
        x.take(c, self.me);
        x.take(self.id, u);
        const [a] = x.chooseCards(u, "Ok comme trade : jouer l'effet d'une de tes cartes ? (facultatif)", playable(x, x.p(u).terrain.filter((c) => c !== self.id)), 0, 1, self.id);
        if (a) x.activateCard(a, u);
      },
    },
  },
};
