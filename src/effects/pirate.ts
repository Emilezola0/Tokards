// Pirate — effets automatiques. Beaucoup de cartes jouent avec la main : défausser, voler, révéler, jouer depuis la main.
// « Jouer une carte » depuis une main = la poser en dernière position du terrain puis activer son effet.
// Les choix d'interprétation sont notés dans la colonne « Précisions » du tableau.
import { card } from "../data/cards";
import * as E from "../game/engine";
import type { BlackHole } from "../game/types";
import { noPlayReason } from "./runtime";
import type { CardScript, Ctx } from "./runtime";

const P: BlackHole = "Primordial";
const Q: BlackHole = "Quasar";
const B: BlackHole = "Blazard";
const T: BlackHole = "Trou de ver";

const isSent = (x: Ctx, id: string) => E.tagsOf(x.g, id).sentience;
const isArmed = (x: Ctx, id: string) => (x.g.armed ?? []).includes(id);
const arm = (x: Ctx, id: string) => !isArmed(x, id) && (x.g.armed = [...(x.g.armed ?? []), id]);
const disarm = (x: Ctx, id: string) => (x.g.armed = (x.g.armed ?? []).filter((c) => c !== id));
const mark = (x: Ctx, id: string) => x.g.marks?.[id];
function setMark(x: Ctx, id: string, v: string | null) {
  const m = { ...(x.g.marks ?? {}) };
  if (v === null) delete m[id];
  else m[id] = v;
  x.g.marks = m;
}
/** Cartes d'une main qui peuvent être jouées (posées depuis la main). */
const playableFromHand = (x: Ctx, hand: string[], except?: string) => hand.filter((c) => c !== except && !noPlayReason(x.g, c));

/** Joue une carte : `me` choisit sa place sur le terrain de `uid` (sauf `index` imposé), elle y est posée et son effet s'active pour `me`. */
function playCard(x: Ctx, c: string, me: string, uid = me, index?: number) {
  const from = E.locate(x.g, c);
  const slot = index ?? x.chooseSlot(me, `Où poser « ${card(c).name} » ?`, uid, c);
  if (!x.move(c, { uid, zone: "terrain", index: slot }, { activate: me })) return false;
  if (from?.zone === "terrain" && E.locate(x.g, c)?.zone === "terrain") x.activateCard(c, me);
  return true;
}

export const PIRATE: Record<string, CardScript> = {
  // Pillage : sentience vraie → vole une carte (face cachée) de la main d'un joueur, elle va dans ta main
  "PIR-01": {
    activate: (x, { id, me }) => {
      if (!x.p(me).sentience) {
        x.reason = "Ta sentience est fausse.";
        return false;
      }
      const u = x.choosePlayer(me, "Pillage : quelle main piller ?", x.others(me).filter((u) => x.p(u).hand.length), id);
      if (!u) {
        x.reason = "Aucun adversaire n'a de carte en main.";
        return false;
      }
      const c = x.chooseCard(me, `Choisis une carte (face cachée) de la main de ${x.name(u)}.`, x.p(u).hand, id, true);
      if (c && x.move(c, { uid: me, zone: "hand" })) x.take(c, me);
    },
  },

  // Tonneaux (passif) : défausse depuis ta main +20, depuis ton terrain +10, autre déplacement d'une de tes cartes +5
  "PIR-02": {
    on: {
      cardMoved: (x, self, e) => {
        if (e.from.uid !== self.me || e.card === self.id) return;
        if (e.from.zone === "deck") return;
        const n = e.to?.zone === "discard" ? (e.from.zone === "hand" ? 20 : e.from.zone === "terrain" ? 10 : 5) : 5;
        if (e.to && e.to.uid === e.from.uid && e.to.zone === e.from.zone && e.to.index === e.from.index) return;
        x.triggered(self, `« ${card(e.card).name} » ${e.to?.zone === "discard" ? "est défaussée" : "bouge"} : +${n} gold.`);
        x.gain(self.me, n);
      },
    },
  },

  // Canon : si tu n'es pas en Trou de ver, envoie une carte de ton terrain, ta main ou ta défausse sur le terrain d'un joueur sentient
  "PIR-03": {
    activate: (x, { id, me }) => {
      if (x.p(me).blackHole === T) {
        x.reason = "Tu es en Trou de ver.";
        return false;
      }
      const targets = x.others(me).filter((u) => x.p(u).sentience);
      if (!targets.length) {
        x.reason = "Aucun autre joueur n'a la sentience vraie.";
        return false;
      }
      const p = x.p(me);
      const pool = [...p.terrain.filter((c) => c !== id), ...p.hand, ...p.discard];
      const [c] = x.chooseCards(me, "Canon : quelle carte envoyer ? (facultatif)", pool, 0, 1, id);
      if (!c) return x.log("Canon : aucun tir.");
      const u = x.choosePlayer(me, `Canon : sur quel terrain envoyer « ${card(c).name} » ?`, targets, id);
      if (!u) return;
      const from = E.locate(x.g, c);
      const slot = x.chooseSlot(me, `Canon : à quelle place sur le terrain de ${x.name(u)} ?`, u, c, id);
      if (!x.move(c, { uid: u, zone: "terrain", index: slot })) return;
      if (from?.zone === "terrain") x.placedActivate(c, u);
    },
  },

  // Cache Oeil (passif, au début de ton tour)
  "PIR-04": {
    activate: (x, { id, me }) => {
      const p = x.p(me);
      if (p.sentience) {
        const top = p.deck.slice(0, 2);
        if (!top.length) {
          x.reason = "Ta pioche est vide.";
          return false;
        }
        const flip = top.length > 1 ? x.chooseCard(me, "Cache Oeil : retourne une des deux cartes (à l'aveugle) : elle sera visible de tous.", top, id, true)! : top[0];
        x.log(`👁 Cache Oeil retourne « ${card(flip).name} » : elle est visible de tous.`, { dst: flip });
        const hidden = top.find((c) => c !== flip);
        const take =
          hidden &&
          x.chooseOption(
            me,
            "Cache Oeil : quelle carte prendre en main ? L'autre retourne au fond de ta pioche.",
            [`La carte visible : « ${card(flip).name} »`, "La carte cachée"],
            id,
          ) === 1
            ? hidden
            : flip;
        x.move(take, { uid: me, zone: "hand" });
        if (take === flip) x.g.revealed = [...(x.g.revealed ?? []).filter((r) => r !== flip), flip];
        for (const o of top) if (o !== take) x.move(o, { uid: me, zone: "deck", bottom: true });
        x.log(
          take === flip
            ? `👁 « ${card(flip).name} » va, visible de tous, dans la main de ${x.name(me)}.`
            : `👁 ${x.name(me)} prend la carte cachée ; « ${card(flip).name} » retourne dans la pioche.`,
        );
        return;
      }
      const pool = p.terrain.filter((c) => c !== id && !(x.g.facedown ?? []).includes(c));
      const c = x.chooseCard(me, "Cache Oeil : quelle carte de ton terrain retourner face cachée ?", pool, id);
      if (!c) {
        x.reason = "Aucune autre carte à retourner sur ton terrain.";
        return false;
      }
      x.disable(c);
      x.g.facedown = [...(x.g.facedown ?? []), c];
      x.log(`👁 « ${card(c).name} » est retournée face cachée : désactivée jusqu'à son prochain tour de jeu.`, { dst: c });
      x.setSentience(me, true);
    },
  },

  // Crochet : Blazard → joue une carte de ta main puis la défausse ; Trou de ver → une carte de la main
  // d'un autre se joue pour lui puis va dans sa défausse ; sentience vraie → pioche une carte
  "PIR-05": {
    activate: (x, { id, me }) => {
      const bh = x.p(me).blackHole;
      let did = false;
      if (bh === B) {
        const c = x.chooseCard(me, "Crochet : quelle carte de ta main jouer ?", playableFromHand(x, x.p(me).hand), id);
        if (c) {
          did = true;
          playCard(x, c, me);
          if (E.locate(x.g, c)) x.discard(c);
        }
      } else if (bh === T) {
        const u = x.choosePlayer(me, "Crochet : dans quelle main choisir ?", x.others(me).filter((u) => playableFromHand(x, x.p(u).hand).length), id);
        if (u) {
          const c = x.chooseCard(me, `Choisis une carte (face cachée) de la main de ${x.name(u)} : elle se joue pour lui.`, playableFromHand(x, x.p(u).hand), id, true);
          if (c) {
            did = true;
            playCard(x, c, u, u);
            if (E.locate(x.g, c)) x.discard(c);
          }
        }
      }
      if (x.p(me).sentience) {
        did = x.draw(me, 1) > 0 || did;
      }
      if (!did) {
        x.reason = "Ni Blazard ni Trou de ver avec une carte à jouer, et sentience fausse.";
        return false;
      }
    },
  },

  // Supplice de la planche : un joueur avec ton trou noir paie 100 gold ou te donne toute sa main (tu lui rends autant de cartes)
  "PIR-06": {
    activate: (x, { id, me }) => {
      const bh = x.p(me).blackHole;
      const pool = x.others(me).filter((u) => x.p(u).blackHole === bh);
      const u = x.choosePlayer(me, "Supplice de la planche : quel joueur ?", pool, id);
      if (!u) {
        x.reason = `Aucun autre joueur n'est en ${bh}.`;
        return false;
      }
      const canPay = x.p(u).gold >= 100;
      const hand = [...x.p(u).hand];
      const opts = [canPay ? "Payer 100 gold" : "Payer 100 gold (pas assez de gold)", `Donner toute ta main (${hand.length} carte${hand.length > 1 ? "s" : ""})`];
      const pick = canPay ? x.chooseOption(u, `Supplice de la planche : ${x.name(me)} te fait marcher sur la planche.`, opts, id) : 1;
      if (pick === 0) {
        x.transfer(u, me, 100);
        return;
      }
      if (!hand.length) return x.log(`${x.name(u)} n'a aucune carte en main.`);
      for (const c of hand) x.moveExchange(c, { uid: me, zone: "hand" });
      x.log(`🏴‍☠️ ${x.name(u)} donne toute sa main (${hand.length}) à ${x.name(me)}.`, { to: me });
      const back = x.chooseCards(me, `Rends ${hand.length} carte(s) de ta main à ${x.name(u)}.`, x.p(me).hand, hand.length, hand.length, id);
      for (const c of back) x.moveExchange(c, { uid: u, zone: "hand" });
    },
  },

  // Rat (passif) : quand il est posé, il saute sur un autre terrain au hasard. Au début du tour du joueur qui l'a :
  // sa sentience passe à fausse, il paie 5 gold par carte 🧠 de son terrain, puis le rat change de terrain au hasard.
  "PIR-07": {
    activate: (x, { id }) => {
      const at = E.locate(x.g, id);
      if (at?.zone !== "terrain") return false;
      if (x.g.born?.[id] === E.pos(x.g)) return x.log("🐀 Le rat vient d'arriver : il attend son prochain tour de jeu.");
      const u = at.uid;
      const n = x.p(u).terrain.filter((c) => isSent(x, c)).length;
      x.log(`🐀 Maladie : ${x.name(u)} passe en sentience fausse et paie ${5 * n} gold.`, { to: u });
      x.setSentience(u, false);
      if (n) x.lose(u, 5 * n);
      ratJump(x, id, u);
    },
    on: {
      placed: (x, self, e) => {
        if (e.card !== self.id || e.src === self.id) return;
        ratJump(x, self.id, E.locate(x.g, self.id)?.uid ?? self.me);
      },
    },
  },

  // Voile : au choix selon le trou noir
  "PIR-08": {
    activate: (x, { id, me }) => {
      const bh = x.p(me).blackHole;
      const what: Record<BlackHole, string> = {
        Blazard: "piocher 2 cartes et en poser jusqu'à 2 (sans effet)",
        "Trou de ver": "remettre une carte de ta main dans la pioche, mélanger et piocher",
        Quasar: "piocher 2 cartes et défausser jusqu'à 2 cartes de ton terrain",
        Primordial: "tous les joueurs jouent 2 fois leurs cartes à leur prochain tour, puis la Voile disparaît",
      };
      if (!x.confirm(me, `Voile (${bh}) : ${what[bh]} ?`, id)) return x.log("Voile : effet non utilisé.");
      if (bh === B) {
        x.draw(me, 2);
        const picks = x.chooseCards(me, "Voile : poser jusqu'à 2 cartes de ta main (leurs effets ne s'activent pas).", playableFromHand(x, x.p(me).hand), 0, 2, id);
        for (const c of picks) x.move(c, { uid: me, zone: "terrain" }, { activate: false });
      } else if (bh === T) {
        const c = x.chooseCard(me, "Voile : quelle carte remettre dans ta pioche ?", x.p(me).hand, id);
        if (c) x.move(c, { uid: me, zone: "deck" });
        x.shuffleZone(me, "deck");
        x.draw(me, 1);
      } else if (bh === Q) {
        x.draw(me, 2);
        const picks = x.chooseCards(me, "Voile : défausser jusqu'à 2 cartes de ton terrain.", x.p(me).terrain.filter((c) => c !== id), 0, 2, id);
        for (const c of picks) x.discard(c);
      } else {
        x.g.double = x.turnOrder();
        x.log("⛵ Voile : au prochain tour de chaque joueur, chaque carte de son terrain se joue deux fois. La Voile ne pourra plus jamais être jouée.");
        x.disable(id);
      }
    },
  },

  // Typhon : défausse 2 cartes de ta main par cran, ton trou noir avance d'autant de crans (Blazard → Quasar → Trou de ver → Primordial)
  "PIR-09": {
    activate: (x, { id, me }) => {
      const max = Math.floor(x.p(me).hand.length / 2);
      if (!max) {
        x.reason = "Il faut au moins 2 cartes en main.";
        return false;
      }
      const steps = x.chooseNumber(me, "Typhon : de combien de crans avancer ton trou noir ? (2 cartes par cran, 0 = rien)", 0, max, id);
      if (!steps) return x.log("Typhon : rien n'est défaussé.");
      const cards = x.chooseCards(me, `Typhon : défausse ${2 * steps} cartes de ta main.`, x.p(me).hand, 2 * steps, 2 * steps, id);
      for (const c of cards) x.discard(c);
      for (let i = 0; i < steps; i++) x.cycleBlackHole(me, [B, Q, T, P]);
    },
  },

  // Sabre : défausse X cartes de ta main pour un effet
  "PIR-10": {
    activate: (x, { id, me }) => {
      const n = x.p(me).hand.length;
      const all: [number, string][] = [
        [1, "1 carte : gagner ou donner 1 à 10 gold"],
        [2, "2 cartes : changer la sentience d'un joueur"],
        [3, "3 cartes : voler une carte (terrain, main ou pioche d'un autre joueur) dans ta main"],
        [5, "5 cartes : inverser la sentience de tous les joueurs"],
        [10, "10 cartes : valider une condition de victoire d'un autre joueur"],
      ];
      const opts = all.filter(([k]) => k <= n);
      if (!opts.length) {
        x.reason = "Ta main est vide.";
        return false;
      }
      const i = x.chooseOption(me, "Sabre : combien de cartes défausser ?", ["Rien", ...opts.map(([, t]) => t)], id);
      if (i === 0) return x.log("Sabre : rien n'est défaussé.");
      const k = opts[i - 1][0];
      const cards = x.chooseCards(me, `Sabre : défausse ${k} carte${k > 1 ? "s" : ""} de ta main.`, x.p(me).hand, k, k, id);
      for (const c of cards) x.discard(c);
      if (k === 1) {
        const v = x.chooseNumber(me, "Sabre : combien de gold (1 à 10) ?", 1, 10, id);
        const u = x.choosePlayer(me, `Sabre : qui reçoit ${v} gold ? (toi = tu les gagnes, un autre = tu les lui donnes)`, x.turnOrder(), id);
        if (!u || u === me) x.gain(me, v);
        else x.transfer(me, u, v);
      } else if (k === 2) {
        const u = x.choosePlayer(me, "Sabre : la sentience de qui changer ?", x.turnOrder(), id);
        if (u) x.invertSentience(u);
      } else if (k === 3) {
        const u = x.choosePlayer(
          me,
          "Sabre : chez quel joueur voler ?",
          x.others(me).filter((u) => x.p(u).terrain.length + x.p(u).hand.length + x.p(u).deck.length),
          id,
        );
        if (!u) return x.log("Sabre : personne à voler.");
        const zones = (["terrain", "hand", "deck"] as const).filter((z) => x.p(u)[z].length);
        const labels = {
          terrain: "Son terrain",
          hand: "Sa main (à l'aveugle)",
          deck: "Sa pioche (à l'aveugle)",
        };
        const z =
          zones[
            x.chooseOption(
              me,
              `Sabre : où voler chez ${x.name(u)} ?`,
              zones.map((z) => labels[z]),
              id,
            )
          ];
        const c = x.chooseCard(me, `Sabre : quelle carte voler (${labels[z].toLowerCase()}) ?`, x.p(u)[z], id, z !== "terrain");
        if (c && x.move(c, { uid: me, zone: "hand" })) x.take(c, me);
      } else if (k === 5) {
        for (const u of x.turnOrder()) x.invertSentience(u);
      } else {
        const alive = x.turnOrder().filter((u) => !x.p(u).out);
        const opts2: { label: string; run: () => void }[] = [];
        for (const u of alive.filter((u) => u !== me))
          if (x.p(u).personalVC && !x.p(u).personalDone)
            opts2.push({
              label: `Personnelle de ${x.name(u)} : « ${card(x.p(u).personalVC!).name} »`,
              run: () => E.setPersonalDone(x.room, x.g, u, true),
            });
        if (x.g.commonVC)
          for (const key of [...new Set(alive.map((u) => E.teamKey(x.room, u)))]) {
            if (x.g.commonDone.includes(key)) continue;
            const who = alive
              .filter((u) => E.teamKey(x.room, u) === key)
              .map((u) => x.name(u))
              .join(", ");
            opts2.push({
              label: `Commune pour ${who}`,
              run: () => E.setCommonDone(x.room, x.g, key, true),
            });
          }
        if (!opts2.length) return x.log("Sabre : plus aucune condition à valider.");
        opts2[
          x.chooseOption(
            me,
            "Sabre : quelle condition de victoire valider ?",
            opts2.map((o) => o.label),
            id,
          )
        ].run();
      }
    },
  },

  // Pistolet : une carte de ta main ou de celle d'un allié est posée sur n'importe quel terrain et s'active ;
  // le Pistolet revient dans ta main. Sentience fausse : 50 % d'exploser (la carte et le Pistolet sont défaussés).
  "PIR-11": {
    activate: (x, { id, me }) => {
      const hands = x.team(me).flatMap((u) => playableFromHand(x, x.p(u).hand));
      const c = x.chooseCard(me, "Pistolet : quelle carte tirer (ta main ou celle d'un allié) ?", hands, id);
      if (!c) {
        x.reason = "Aucune carte à jouer dans ta main ni dans celle d'un allié.";
        return false;
      }
      if (!x.p(me).sentience && x.dice(me, 2) === 1) {
        x.log("💥 Le Pistolet explose !");
        x.discard(c);
        x.discard(id);
        return;
      }
      const u = x.choosePlayer(me, `Pistolet : sur quel terrain poser « ${card(c).name} » ?`, x.turnOrder(), id)!;
      const slot = x.chooseSlot(me, `Pistolet : à quelle place sur le terrain de ${x.name(u)} ?`, u, c, id);
      playCard(x, c, me, u, slot);
      if (E.locate(x.g, id)?.zone === "terrain") x.move(id, { uid: me, zone: "hand" });
    },
  },

  // Black pearl : 10 % de réussite, selon le trou noir, puis elle va dans la défausse
  "PIR-12": {
    activate: (x, { id, me }) => {
      if (x.dice(me, 10) !== 1) return x.log("Black pearl : raté (10 % de chances), elle reste en place.");
      const bh = x.p(me).blackHole;
      if (bh === B) {
        const u = x.choosePlayer(me, "Black pearl : quel terrain aborder ?", x.others(me).filter((u) => x.p(u).terrain.length), id);
        if (u) {
          const picks = x.chooseCards(me, "Black pearl : choisis jusqu'à 3 cartes (25 % de chances de voler chacune).", x.p(u).terrain, 1, 3, id);
          for (const c of picks) {
            if (x.dice(me, 4) === 1) {
              if (x.move(c, { uid: me, zone: "hand" })) x.take(c, me);
            } else x.log(`« ${card(c).name} » : raté.`, { dst: c });
          }
        }
      } else if (bh === P) {
        const u = x.choosePlayer(
          me,
          "Black pearl : quel terrain piller ?",
          x.others(me).filter((u) => x.p(u).terrain.length),
          id,
        );
        if (u) {
          const picks = x.chooseCards(me, `Black pearl : prends jusqu'à 3 cartes du terrain de ${x.name(u)}.`, x.p(u).terrain, 1, 3, id);
          let n = 0;
          for (const c of picks)
            if (x.move(c, { uid: me, zone: "hand" }) && E.locate(x.g, c)?.uid === me) {
              x.take(c, me);
              n++;
            }
          if (n) {
            x.gain(me, 25 * n);
            x.gain(u, 25 * n);
          }
        }
      } else if (bh === T) {
        x.shuffleZone(me, "deck");
        x.draw(me, 3);
      } else {
        const pool = [...x.p(me).terrain.filter((c) => c !== id), ...x.p(me).hand];
        const picks = x.chooseCards(me, "Black pearl : sacrifie jusqu'à 3 cartes (terrain ou main) : pour chacune, Black pearl est repiochée et reposée.", pool, 0, 3, id);
        for (const c of picks) {
          x.discard(c);
          if (!x.move(id, { uid: me, zone: "deck" })) break;
          x.draw(me, 1);
          if (E.locate(x.g, id)?.zone !== "hand") continue;
          playCard(x, id, me);
        }
        return;
      }
      if (E.locate(x.g, id)) x.discard(id);
    },
  },

  // Perroquet : sentience vraie → regarde la main d'un joueur, puis le Perroquet va dans ta main
  "PIR-13": {
    activate: (x, { id, me }) => {
      if (!x.p(me).sentience) {
        x.reason = "Ta sentience est fausse.";
        return false;
      }
      const u = x.choosePlayer(me, "Perroquet : quelle main regarder ?", x.others(me).filter((u) => x.p(u).hand.length), id);
      if (!u) {
        x.reason = "Aucun adversaire n'a de carte en main.";
        return false;
      }
      x.chooseCards(me, `🦜 Main de ${x.name(u)} (valide pour continuer).`, x.p(u).hand, 0, 0, id);
      x.log(`🦜 ${x.name(me)} regarde la main de ${x.name(u)}.`, { to: u });
      x.interact(u, "hand");
      x.move(id, { uid: me, zone: "hand" });
    },
  },

  // Crew : pour 25 gold, jusqu'à 4 cartes 🧠 de ton terrain ou de ta main se jouent
  "PIR-14": {
    activate: (x, { id, me }) => {
      const p = x.p(me);
      const pool = [...p.terrain.filter((c) => c !== id && x.canActivate(c) && !x.isDisabled(c)), ...playableFromHand(x, p.hand)].filter((c) => isSent(x, c));
      if (!pool.length) {
        x.reason = "Aucune carte 🧠 à jouer sur ton terrain ou dans ta main.";
        return false;
      }
      if (!x.canPay(me, 25)) {
        x.reason = "Il faut 25 gold.";
        return false;
      }
      const picks = x.chooseCards(me, "Crew : quelles cartes 🧠 jouer (jusqu'à 4) pour 25 gold ? (aucune = rien)", pool, 0, 4, id);
      if (!picks.length) return x.log("Crew : rien n'est joué.");
      if (!x.spend(me, 25)) return false;
      for (const c of picks) {
        const at = E.locate(x.g, c);
        if (at?.zone === "hand" && at.uid === me) playCard(x, c, me);
        else if (at?.zone === "terrain") x.activateCard(c, me);
      }
    },
  },

  // Kraken : obligatoire si tu n'es pas en Trou de ver : 8 cartes de ton terrain, chacune 25 % d'être défaussée
  "PIR-15": {
    activate: (x, { id, me }) => {
      const t = x.p(me).terrain.filter((c) => c !== id);
      if (x.p(me).blackHole === T && !x.confirm(me, "Kraken : tu es en Trou de ver, le lâcher quand même ?", id)) return x.log("Kraken : il reste au fond.");
      const picks = x.chooseCards(me, "Kraken : choisis 8 cartes de ton terrain (25 % de chances d'être défaussée chacune).", t, Math.min(8, t.length), 8, id);
      for (const c of picks) {
        if (x.dice(me, 4) === 1) x.discard(c);
        else x.log(`« ${card(c).name} » résiste au Kraken.`, { dst: c });
      }
    },
  },

  // Tempête : pendant ton prochain tour, si ton trou noir passe à Blazard, les cartes de ta main sont révélées et se jouent
  "PIR-16": {
    activate: (x, { id, me }) => {
      setMark(x, id, `${me}:${E.pos(x.g)}`);
      x.log("🌩 Tempête : si ton trou noir passe à Blazard pendant ton prochain tour, toute ta main se jouera.");
    },
    on: {
      blackHole: (x, self, e) => {
        const m = mark(x, self.id);
        if (!m || e.uid !== self.me || e.to !== B || x.current !== self.me) return;
        const [uid, at] = m.split(":");
        if (uid !== self.me || E.pos(x.g) <= Number(at)) return;
        setMark(x, self.id, null);
        const hand = [...x.p(self.me).hand];
        x.g.revealed = [...new Set([...(x.g.revealed ?? []), ...hand])];
        x.triggered(
          self,
          `Blazard ! La main de ${x.name(self.me)} est révélée : ${hand.map((c) => `« ${card(c).name} »`).join(", ") || "vide"}. Ses cartes se jouent en restant dans la main.`,
        );
        for (const c of hand) if (E.locate(x.g, c)?.zone === "hand" && x.canActivate(c)) x.activateCard(c, self.me);
      },
      turnEnd: (x, self, e) => {
        const m = mark(x, self.id);
        if (!m || e.uid !== self.me) return;
        const [uid, at] = m.split(":");
        if (uid === self.me && E.pos(x.g) > Number(at)) setMark(x, self.id, null);
      },
    },
  },

  // Mer : sentience vraie → chaque carte avant la Mer : 25 % retour en main, 25 % défaussée, 50 % +10 gold
  "PIR-17": {
    activate: (x, { id, me }) => {
      if (!x.p(me).sentience) {
        x.reason = "Ta sentience est fausse.";
        return false;
      }
      const at = E.locate(x.g, id)!;
      const before = x.p(at.uid).terrain.slice(0, at.index);
      if (!before.length) {
        x.reason = "Aucune carte avant la Mer.";
        return false;
      }
      for (const c of before) {
        const v = x.dice(me, 4);
        if (v === 1) x.move(c, { uid: me, zone: "hand" });
        else if (v === 2) x.discard(c);
        else x.gain(me, 10);
      }
    },
  },

  // Le Fatigué : donne 25 gold à un joueur, puis au début de ton prochain tour, 1 chance sur 2 de gagner 100 gold, et il se défausse
  "PIR-18": {
    activate: (x, { id, me }) => {
      if (isArmed(x, id)) {
        disarm(x, id);
        if (x.dice(me, 2) === 1) {
          x.log("😴 Le Fatigué se réveille avec 100 gold !");
          x.gain(me, 100);
        } else x.log("😴 Le Fatigué se réveille les poches vides.");
        x.discard(id);
        return;
      }
      if (x.p(me).gold < 25) {
        x.reason = "Il faut 25 gold.";
        return false;
      }
      const u = x.choosePlayer(me, "Le Fatigué : à qui dois-tu 25 gold ?", x.others(me), id);
      if (!u) return false;
      x.transfer(me, u, 25);
      arm(x, id);
      x.log("😴 Le Fatigué se met sur le côté : à sa prochaine activation, 1 chance sur 2 de rapporter 100 gold.");
    },
  },

  // Coffre : dé trou noir ; si c'est ton trou noir, gagne 1d100 gold et ton trou noir devient un nouveau jet
  "PIR-19": {
    activate: (x, { me }) => {
      const v = x.bhDice(me);
      if (v !== x.p(me).blackHole) {
        x.reason = `Le dé donne ${v} : le coffre reste fermé.`;
        return false;
      }
      x.log("🗝 Le coffre s'ouvre !");
      x.gain(me, x.dice(me, 100));
      x.setBlackHole(me, x.bhDice(me));
    },
  },

  // Rhum : sentience vraie → la carte suivante se joue une fois de plus ; fausse → sentience vraie et la carte suivante ne se joue pas
  "PIR-20": {
    activate: (x, { id, me }) => {
      const at = E.locate(x.g, id)!;
      const next = x.p(at.uid).terrain[at.index + 1];
      if (x.p(me).sentience) {
        if (!next || !x.canActivate(next) || x.isDisabled(next)) {
          x.reason = "Pas de carte juste après avec un effet à jouer.";
          return false;
        }
        x.log(`🍺 Rhum : « ${card(next).name} » se joue une fois de plus.`, {
          dst: next,
        });
        x.activateCard(next, me);
        return;
      }
      x.setSentience(me, true);
      if (next) {
        x.log(`🍺 Trop bourré : « ${card(next).name} » ne se joue pas ce tour.`, { dst: next });
        x.disable(next, x.untilEndOfTurn());
      }
    },
  },
};

/** Le rat saute sur le terrain d'un autre joueur tiré au hasard. */
function ratJump(x: Ctx, id: string, from: string) {
  const u = x.randomPlayer(x.others(from).filter((u) => !x.p(u).out));
  if (u) x.move(id, { uid: u, zone: "terrain" });
}
