// Météo — effets automatiques. Chaque joueur a une météo, un état à part de son trou noir :
// Beau temps (au départ), Pluie, Vent violent, Canicule, Neige, Grêle ou Orage (Orage = la carte Orage est sur son terrain).
// « Il pleut », « canicule »… = la météo du lanceur, sauf pour les cartes « qui s'appliquent à tous les joueurs ».
// Les choix d'interprétation sont notés dans l'onglet « Interprétations » du tableau.
import { card } from "../data/cards";
import * as E from "../game/engine";
import type { BlackHole, Weather } from "../game/types";
import { BH_WEATHER, weatherIcon, weatherLabel } from "../game/types";
import type { CardScript, Ctx, Self } from "./runtime";

const P: BlackHole = "Primordial";
const Q: BlackHole = "Quasar";
const B: BlackHole = "Blazard";
const T: BlackHole = "Trou de ver";
const ORAGE = E.ORAGE;
/** Météos qu'une carte peut choisir ou tirer (l'Orage ne vient que de sa carte). */
const SKY: Weather[] = ["Pluie", "Vent violent", "Canicule", "Neige", "Grêle"];

const tags = (x: Ctx, id: string) => E.tagsOf(x.g, id);
const num = (x: Ctx, key: string) => Number(x.g.marks?.[key] ?? 0) || 0;
function setMark(x: Ctx, key: string, v: string | number | null) {
  const m = { ...(x.g.marks ?? {}) };
  if (v === null) delete m[key];
  else m[key] = String(v);
  x.g.marks = m;
}
const isArmed = (x: Ctx, id: string) => (x.g.armed ?? []).includes(id);
const arm = (x: Ctx, id: string) => !isArmed(x, id) && (x.g.armed = [...(x.g.armed ?? []), id]);
const disarm = (x: Ctx, id: string) => (x.g.armed = (x.g.armed ?? []).filter((c) => c !== id));

/** Joueurs (lanceur compris) dont la sentience est vraie et la météo `w`. */
const touched = (x: Ctx, w: Weather) => x.turnOrder().filter((u) => !x.p(u).out && x.p(u).sentience && x.weather(u) === w);
/** La météo du lanceur doit être `ws` (sinon l'effet échoue). */
function need(x: Ctx, me: string, ...ws: Weather[]) {
  const w = x.weather(me);
  if (w && ws.includes(w)) return true;
  x.reason = `Il faut ${ws.join(" ou ")} (ta météo : ${weatherLabel(w)}).`;
  return false;
}
/** Désactive une carte jusqu'à son prochain passage (fin du tour de son joueur). */
function skipNextPlay(x: Ctx, c: string) {
  const u = E.locate(x.g, c)?.uid ?? x.current;
  x.disable(c, u === x.current ? x.untilEndOfTurn() : x.untilEndOfNext(u));
}
/** Joue une carte : `me` choisit sa place sur le terrain de `uid`, elle y est posée et son effet s'active pour `me`. */
function playCard(x: Ctx, c: string, me: string, uid = me) {
  const from = E.locate(x.g, c);
  const slot = x.chooseSlot(me, `Où poser « ${card(c).name} » ?`, uid, c);
  if (!x.move(c, { uid, zone: "terrain", index: slot }, { activate: me })) return false;
  if (from?.zone === "terrain" && E.locate(x.g, c)?.zone === "terrain") x.activateCard(c, me);
  return true;
}
const activatable = (x: Ctx, list: string[], except?: string) => list.filter((c) => c !== except && x.canActivate(c) && !x.isDisabled(c));

/** Fait arriver l'Orage sur le terrain de `me` (à la place `index`). */
function summonStorm(x: Ctx, me: string, index?: number) {
  const at = E.locate(x.g, ORAGE);
  if (!at) {
    x.log("L'Orage n'est pas en jeu : rien ne se passe.");
    return false;
  }
  if (at.zone === "terrain") {
    x.log(`L'Orage gronde déjà sur le terrain de ${x.name(at.uid)}.`);
    return false;
  }
  return x.move(ORAGE, { uid: me, zone: "terrain", index });
}

/** Une carte de l'autre joueur à la même météo se joue pour `u` (Météo photoshoppée). */
function photoshop(x: Ctx, self: Self, u: string) {
  const w = x.weather(u);
  if (!w) return false;
  const twins = x.others(u).filter((o) => !x.p(o).out && x.weather(o) === w);
  const pool = twins.flatMap((o) => activatable(x, x.p(o).terrain, self.id));
  if (!pool.length) return false;
  const [c] = x.chooseCards(u, `Météo photoshoppée (${w}) : jouer pour toi une carte d'un joueur qui a la même météo ? (facultatif)`, pool, 0, 1, self.id);
  if (!c) return false;
  x.activateCard(c, u);
  return true;
}

/** Gain lié à un changement de météo (Pas Temps que ça). */
const xFor = (w: Weather | null) => (w === "Canicule" ? 1 : w === "Grêle" ? 20 : w === "Orage" ? 50 : 5);

export const METEO: Record<string, CardScript> = {
  // Météo : la météo de tout le monde suit le trou noir du lanceur
  "MET-01": {
    activate: (x, { me }) => {
      const w = BH_WEATHER[x.p(me).blackHole];
      x.log(`${weatherIcon(w)} ${x.p(me).blackHole} : la météo de tout le monde passe à ${w}.`);
      for (const u of x.turnOrder()) if (!x.p(u).out) x.setWeather(u, w);
    },
  },

  // Météo pays : fait appel à la carte Météo ; si elle est déjà sur un terrain, changer de trou noir pour 10 gold
  "MET-02": {
    activate: (x, { id, me }) => {
      const at = E.locate(x.g, "MET-01");
      if (at?.zone === "terrain") {
        if (!x.canPay(me, 10)) {
          x.reason = "La carte Météo est déjà sur un terrain et il faut 10 gold pour changer de trou noir.";
          return false;
        }
        if (!x.confirm(me, "Météo pays : la carte Météo est déjà en jeu. Changer de trou noir pour 10 gold ?", id)) return x.log("Météo pays : rien ne change.");
        if (!x.spend(me, 10)) return false;
        x.setBlackHole(me, x.chooseBlackHole(me, "Météo pays : nouveau trou noir ?", x.p(me).blackHole, id));
        return;
      }
      if (x.p(me).blackHole === T) {
        x.reason = "Tu es en Trou de ver.";
        return false;
      }
      if (!at) {
        x.reason = "La carte Météo n'est pas en jeu.";
        return false;
      }
      if (!x.confirm(me, "Météo pays : faire appel à la carte Météo et la jouer ?", id)) return x.log("Météo pays : la carte Météo reste où elle est.");
      if (playCard(x, "MET-01", me)) x.take("MET-01", me);
    },
  },

  // Temps pluvieux : joueurs sentients sous la pluie → chaque carte 🧠 a 5 % de retourner dans la pioche
  "MET-03": {
    activate: (x, { id }) => {
      const who = touched(x, "Pluie");
      if (!who.length) {
        x.reason = "Aucun joueur n'a la sentience vraie et la pluie.";
        return false;
      }
      for (const u of who) {
        let back = 0;
        for (const c of x.p(u).terrain.filter((c) => c !== id && tags(x, c).sentience)) {
          if (x.dice(u, 20) === 1 && x.move(c, { uid: u, zone: "deck" })) back++;
        }
        if (back) x.shuffleZone(u, "deck");
        else x.log(`${x.name(u)} : aucune carte ne repart.`);
      }
    },
  },

  // Mistrale : joueurs sentients dans le vent violent → 80 % que l'ordre de leur terrain s'inverse
  "MET-04": {
    activate: (x, { id }) => {
      const who = touched(x, "Vent violent");
      if (!who.length) {
        x.reason = "Aucun joueur n'a la sentience vraie et le vent violent.";
        return false;
      }
      for (const u of who) {
        if (x.dice(u, 10) > 8) {
          x.log(`🌬️ ${x.name(u)} : le vent tombe, l'ordre ne change pas.`);
          continue;
        }
        const t = x.p(u).terrain;
        const keep = t.indexOf(id);
        const rest = t.filter((c) => c !== id).reverse();
        if (keep >= 0) rest.splice(keep, 0, id);
        x.p(u).terrain = rest;
        x.log(`🌬️ Le terrain de ${x.name(u)} se joue dans l'autre sens.`, {
          to: u,
        });
        x.interact(u, "terrain");
      }
    },
  },

  // Hot : joueurs sentients en canicule → chaque carte 🧠 a 50 % de ne pas se jouer
  "MET-05": {
    activate: (x, { id }) => {
      const who = touched(x, "Canicule");
      if (!who.length) {
        x.reason = "Aucun joueur n'a la sentience vraie et la canicule.";
        return false;
      }
      for (const u of who) {
        const hot = x.p(u).terrain.filter((c) => c !== id && tags(x, c).sentience && !(x.g.hot ?? []).includes(c));
        if (!hot.length) continue;
        x.g.hot = [...(x.g.hot ?? []), ...hot];
        x.log(`☀️ Hot : ${hot.map((c) => `« ${card(c).name} »`).join(", ")} de ${x.name(u)} — 1 chance sur 2 de ne pas se jouer à leur prochain passage.`, { to: u });
      }
    },
  },

  // Neige parfaite (passif) : au début du tour d'un joueur sentient sous la neige, 10 % qu'une de ses cartes soit ensevelie
  "MET-06": {
    activate: (x, { id }) => {
      const who = x.turnOrder().filter((u) => !x.p(u).out && x.p(u).sentience && x.weather(u) === "Neige");
      if (!who.length) {
        x.reason = "Aucun joueur n'a la sentience vraie et la neige.";
        return false;
      }
      for (const u of who) {
        const pool = x.p(u).terrain.filter((c) => c !== id && c !== ORAGE);
        if (!pool.length) continue;
        if (x.dice(u, 10) !== 1) {
          x.log(`❄️ ${x.name(u)} : la neige épargne son terrain.`, { to: u });
          continue;
        }
        const c = x.random(pool);
        x.log(`❄️ « ${card(c).name} » de ${x.name(u)} est ensevelie sous la neige.`, { dst: c });
        E.attachUnder(x.g, c, E.SNOW);
        x.fx({ k: "move", card: c });
      }
    },
  },

  // Temps de Grêle : joueurs sentients sous la grêle → 50 % de gagner 50 gold, sinon donnent 25 gold à chaque autre joueur
  "MET-07": {
    activate: (x) => {
      const who = touched(x, "Grêle");
      if (!who.length) {
        x.reason = "Aucun joueur n'a la sentience vraie et la grêle.";
        return false;
      }
      for (const u of who) {
        if (x.dice(u, 2) === 1) x.gain(u, 50);
        else for (const o of x.others(u)) if (!x.p(o).out) x.transfer(u, o, 25);
      }
    },
  },

  // Trace de pneu : sous la neige, gagne 1 gold par carte jouée (par n'importe qui) depuis sa pose
  "MET-08": {
    activate: (x, { id, me }) => {
      if (!need(x, me, "Neige")) return false;
      const n = num(x, id);
      if (!n) return x.log("Trace de pneu : aucune carte jouée sous la neige depuis sa pose.");
      x.gain(me, n);
      setMark(x, id, 0);
    },
    on: {
      placed: (x, self, e) => {
        if (e.card === self.id) setMark(x, self.id, 0);
      },
      activated: (x, self, e) => {
        if (e.card === self.id || x.weather(self.me) !== "Neige") return;
        setMark(x, self.id, num(x, self.id) + 1);
      },
    },
  },

  // Hot-dog : en canicule, tu prends le risque ? 1-20 : +50, 21-40 : −50, 41-100 : tout le monde +20
  "MET-09": {
    activate: (x, { id, me }) => {
      if (!need(x, me, "Canicule")) return false;
      if (!x.confirm(me, "Hot-dog : manger chaud par cette canicule ?", id)) return x.log("Hot-dog : pas de prise de risque.");
      const v = x.dice(me, 100);
      if (v <= 20) x.gain(me, 50);
      else if (v <= 40) x.lose(me, 50);
      else for (const u of x.turnOrder()) if (!x.p(u).out) x.gain(u, 20);
    },
  },

  // Ga-Doux : sous la pluie, chaque joueur qui le veut a 50 % de gagner 1d100/2 gold, sinon il les perd
  "MET-10": {
    activate: (x, { id, me }) => {
      if (!need(x, me, "Pluie")) return false;
      const players = [me, ...x.others(me).filter((u) => !x.p(u).out && x.confirm(u, `Ga-Doux : rejoindre le pari de ${x.name(me)} (gagner ou perdre 1d100/2 gold) ?`, id))];
      for (const u of players) {
        const n = Math.floor(x.dice(u, 100) / 2);
        if (x.dice(u, 2) === 1) x.gain(u, n);
        else x.lose(u, n);
      }
    },
  },

  // Climatisation : selon ta météo
  "MET-11": {
    activate: (x, { id, me }) => {
      const w = x.weather(me);
      if (w === "Pluie") x.setWeather(me, "Grêle");
      else if (w === "Vent violent") {
        const c = x.chooseCard(me, "Climatisation : quelle carte de ton terrain rejouer ?", activatable(x, x.p(me).terrain, id), id);
        if (!c) {
          x.reason = "Aucune autre carte de ton terrain à rejouer.";
          return false;
        }
        x.activateCard(c, me);
      } else if (w === "Canicule") {
        if (!x.canPay(me, 10)) {
          x.reason = "Il faut 10 gold.";
          return false;
        }
        if (!x.confirm(me, "Climatisation : choisir un nouveau trou noir contre ta sentience (fausse) et 10 gold ?", id)) return x.log("Climatisation : rien ne change.");
        if (!x.spend(me, 10)) return false;
        x.setSentience(me, false);
        x.setBlackHole(me, x.chooseBlackHole(me, "Climatisation : nouveau trou noir ?", x.p(me).blackHole, id));
      } else if (w === "Neige" || w === "Grêle") {
        x.setWeather(me, "Pluie");
        x.setBlackHole(me, B);
      } else {
        x.reason = `Rien à climatiser (ta météo : ${weatherLabel(w)}).`;
        return false;
      }
    },
  },

  // Présentateur météo : change ta sentience gratuitement, et celle d'un autre joueur pour 10 gold
  "MET-12": {
    activate: (x, { id, me }) => {
      if (x.confirm(me, `Présentateur météo : inverser ta sentience (gratuit) ?`, id)) x.invertSentience(me);
      let others = x.others(me).filter((u) => !x.p(u).out);
      while (others.length && x.canPay(me, 10)) {
        const i = x.chooseOption(me, "Présentateur météo : changer la sentience d'un autre joueur pour 10 gold ?", ["Personne d'autre", ...others.map((u) => x.name(u))], id);
        if (!i) break;
        const u = others[i - 1];
        if (!x.spend(me, 10)) break;
        x.invertSentience(u);
        others = others.filter((o) => o !== u);
      }
    },
  },

  // Temps d'antenne (passif) : à chaque changement de météo d'un joueur, gagne X gold
  "MET-13": {
    on: {
      weather: (x, self, e) => {
        const gain: Partial<Record<Weather, number>> = {
          Pluie: 5,
          "Vent violent": 15,
          Canicule: -5,
          Neige: 10,
          Grêle: 50,
        };
        const n = e.to ? (gain[e.to] ?? 0) : 0;
        if (!n) return;
        x.triggered(self, `météo de ${x.name(e.uid)} → ${e.to} : ${n > 0 ? "+" : ""}${n} gold.`);
        if (n > 0) x.gain(self.me, n);
        else x.lose(self.me, -n);
      },
    },
  },

  // Temps bien que mal : selon ta météo, puis repositionne jusqu'à 3 cartes de toi et tes alliés
  "MET-14": {
    activate: (x, { id, me }) => {
      const w = x.weather(me);
      if (w === "Canicule") {
        const u = x.choosePlayer(me, "Temps bien que mal : à qui donner 10 gold ?", x.others(me).filter((u) => !x.p(u).out), id);
        if (u) x.transfer(me, u, 10);
      } else if (w === "Vent violent") x.gain(me, x.dice(me, 20));
      const choosers = w === "Grêle" ? x.turnOrder().filter((u) => !x.p(u).out) : [me];
      if (w === "Grêle") x.log("🌨️ Grêle : chaque joueur repositionne ses propres cartes.");
      for (const chooser of choosers) {
        const team = x.team(chooser);
        const pool = team.flatMap((u) => x.p(u).terrain).filter((c) => c !== id);
        const picks = x.chooseCards(chooser, "Temps bien que mal : repositionner jusqu'à 3 cartes (toi et tes alliés).", pool, 0, 3, id);
        for (const c of picks) {
          const u = x.choosePlayer(chooser, `Sur quel terrain mettre « ${card(c).name} » ?`, team, id) ?? chooser;
          const slot = x.chooseSlot(chooser, `À quelle place sur le terrain de ${x.name(u)} ?`, u, c, id);
          x.move(c, { uid: u, zone: "terrain", index: slot });
        }
      }
    },
  },

  // Temps qu'à faire : selon ta météo
  "MET-15": {
    activate: (x, { id, me }) => {
      const w = x.weather(me);
      const all = x.turnOrder().filter((u) => !x.p(u).out);
      if (w === "Pluie") {
        for (const u of all) {
          for (const c of [...x.p(u).hand]) x.move(c, { uid: u, zone: "deck" });
          x.shuffleZone(u, "deck");
          x.draw(u, 4);
        }
      } else if (w === "Vent violent") {
        for (const u of all) {
          if (x.dice(u, 10) !== 1 || x.p(u).terrain.length < 2) continue;
          x.p(u).terrain = E.shuffle(x.p(u).terrain);
          x.log(`🌬️ Le terrain de ${x.name(u)} est mélangé.`, { to: u });
          x.interact(u, "terrain");
        }
      } else if (w === "Canicule") {
        const to = x.chooseBlackHole(me, "Temps qu'à faire : trou noir provisoire (jusqu'à la fin de ton tour) ?", undefined, id);
        if (!(x.g.temp ?? []).some((t) => t.uid === me && t.kind === "bh")) x.g.temp = [...(x.g.temp ?? []), { uid: me, kind: "bh", prev: x.p(me).blackHole }];
        x.setBlackHole(me, to);
      } else if (w === "Grêle") {
        for (const u of all) {
          for (const c of [...x.p(u).hand]) x.move(c, { uid: u, zone: "discard" });
          x.draw(u, 1);
        }
      } else {
        x.reason = `Rien ne se passe avec ta météo (${weatherLabel(w)}).`;
        return false;
      }
    },
  },

  // Temps Pie (passif) : sous la pluie ou le vent, l'argent perdu est stocké ; récupéré en canicule, perdu en grêle ou orage
  "MET-16": {
    on: {
      goldLost: (x, self, e) => {
        const w = x.weather(self.me);
        if (e.uid !== self.me || (w !== "Pluie" && w !== "Vent violent")) return;
        setMark(x, self.id, num(x, self.id) + e.amount);
        x.triggered(self, `${e.amount} gold perdus sont stockés (${num(x, self.id)} en réserve).`);
      },
      weather: (x, self, e) => {
        const n = num(x, self.id);
        if (e.uid !== self.me || !n) return;
        if (e.to === "Canicule") {
          x.triggered(self, `canicule : ${n} gold récupérés.`);
          setMark(x, self.id, 0);
          x.gain(self.me, n);
        } else if (e.to === "Grêle" || e.to === "Orage") {
          x.triggered(self, `${e.to} : les ${n} gold stockés sont perdus.`);
          setMark(x, self.id, 0);
        }
      },
    },
  },

  // Température modérée : peut bloquer la carte Météo, puis météo au hasard ou dé de sentience
  "MET-17": {
    activate: (x, { id, me }) => {
      const met = E.locate(x.g, "MET-01");
      if (met?.zone === "terrain" && !x.isDisabled("MET-01") && x.confirm(me, "Température modérée : bloquer la carte Météo ?", id)) x.disable("MET-01");
      const i = x.chooseOption(me, "Température modérée : que faire ?", ["Rien", "Changer ta météo au hasard", "Lancer le dé de sentience"], id);
      if (i === 1) {
        const w = x.random(SKY);
        x.log(`🎯 Météo tirée au hasard : ${w}.`);
        x.setWeather(me, w);
      } else if (i === 2) x.setSentience(me, x.sentDice(me));
    },
  },

  // Temps tôt fini : sentience vraie → joue une carte de ta main (elle y reste, montrée à tous) et repositionne une carte ;
  // fausse → chaque autre joueur montre et joue une carte de sa main
  "MET-18": {
    activate: (x, { id, me }) => {
      if (x.p(me).sentience) {
        const c = x.chooseCard(me, "Temps tôt fini : quelle carte de ta main jouer (elle reste dans ta main) ?", x.p(me).hand.filter((c) => x.canActivate(c)), id);
        if (c) {
          x.g.revealed = [...(x.g.revealed ?? []).filter((r) => r !== c), c];
          x.log(`👁 ${x.name(me)} montre « ${card(c).name} » et la joue depuis sa main.`, { dst: c });
          x.activateCard(c, me);
        }
        const t = x.p(me).terrain;
        if (t.length > 1) {
          const [m] = x.chooseCards(me, "Temps tôt fini : repositionner une carte de ton terrain ? (facultatif)", t, 0, 1, id);
          if (m)
            x.move(m, {
              uid: me,
              zone: "terrain",
              index: x.chooseSlot(me, `Nouvelle place de « ${card(m).name} » ?`, me, m, id),
            });
        }
        if (!c && t.length <= 1) {
          x.reason = "Aucune carte à jouer ni à déplacer.";
          return false;
        }
        return;
      }
      for (const u of x.others(me)) {
        if (x.p(u).out) continue;
        const c = x.chooseCard(
          u,
          `Temps tôt fini : quelle carte de ta main montrer et jouer (elle reste dans ta main) ?`,
          x.p(u).hand.filter((c) => x.canActivate(c)),
          id,
        );
        if (!c) continue;
        x.g.revealed = [...(x.g.revealed ?? []).filter((r) => r !== c), c];
        x.log(`👁 ${x.name(u)} montre « ${card(c).name} » et la joue depuis sa main.`, { dst: c });
        x.activateCard(c, u);
      }
    },
  },

  // Pas Temps que ça : gagne X gold maintenant, puis à chaque changement de ta météo
  "MET-19": {
    activate: (x, { me }) => {
      x.gain(me, xFor(x.weather(me)));
    },
    on: {
      turnStart: (x, self, e) => {
        if (e.uid === self.me) setMark(x, `${self.id}:seen`, null);
      },
      weather: (x, self, e) => {
        if (E.locate(x.g, self.id)?.zone !== "terrain") return;
        let n = xFor(e.to);
        if (x.current === self.me) {
          const seen = (x.g.marks?.[`${self.id}:seen`] ?? "").split("|").filter(Boolean);
          if (seen.length >= 4) n = 50;
          const k = weatherLabel(e.to);
          if (!seen.includes(k)) setMark(x, `${self.id}:seen`, [...seen, k].join("|"));
        }
        x.triggered(self, `météo de ${x.name(e.uid)} → ${weatherLabel(e.to)} : +${n} gold.`);
        x.gain(self.me, n);
      },
    },
  },

  // Temps de merde : sous la pluie, un orage se prépare ; si la carte est encore là au début de ton prochain tour, l'Orage prend sa place
  "MET-20": {
    activate: (x, { id, me }) => {
      if (isArmed(x, id)) {
        disarm(x, id);
        const at = E.locate(x.g, id);
        if (at?.zone !== "terrain") return false;
        x.log("⛈️ L'orage éclate !", { dst: id });
        x.discard(id);
        summonStorm(x, at.uid, at.index);
        return;
      }
      if (!need(x, me, "Pluie")) return false;
      arm(x, id);
      x.log("⛈️ Un orage se prépare : à la prochaine activation de cette carte, l'Orage arrive.");
    },
  },

  // Orage (passif) : ne se pose que par Temps de merde (ou Temps pour prier), ne bouge pas (sauf Éclaircissement).
  // Les cartes Sentience et Gold de son terrain ne se jouent plus. À la fin du tour de son joueur, il part sur un terrain
  // au hasard ; au bout de 5 tours, il disparaît (défausse de son propriétaire).
  "MET-21": {
    placedOnlyBy: ["MET-20", "MET-22"],
    immovableExcept: ["MET-29"],
    noPlay: "L'Orage ne se pose qu'avec « Temps de merde ».",
    on: {
      placed: (x, self, e) => {
        if (e.card === self.id && e.src !== self.id) setMark(x, self.id, 0);
      },
      turnEnd: (x, self, e) => {
        const n = num(x, self.id) + 1;
        setMark(x, self.id, n);
        if (n >= 5) {
          setMark(x, self.id, null);
          x.triggered(self, "après 5 tours, l'orage se dissipe.");
          x.move(self.id, {
            uid: x.g.owner[self.id] ?? self.me,
            zone: "discard",
          });
          return;
        }
        if (e.uid !== self.me) return;
        const u = x.randomPlayer(x.others(self.me).filter((u) => !x.p(u).out));
        if (u) {
          x.triggered(self, `l'orage se déplace (${n}/5 tours).`);
          x.move(self.id, { uid: u, zone: "terrain" });
        }
      },
    },
  },

  // Temps pour prier : 25 % de pouvoir changer ta météo, puis 1d100 : 1 → Orage (ou +500 s'il est déjà chez toi),
  // 100 → +250 gold, 50 → donne 50 gold à chaque joueur
  "MET-22": {
    activate: (x, { id, me }) => {
      if (x.dice(me, 4) === 1) {
        const i = x.chooseOption(me, "Temps pour prier : ta nouvelle météo ?", SKY.map((w) => `${weatherIcon(w)} ${w}`), id);
        x.setWeather(me, SKY[i]);
      } else x.log("Temps pour prier : la météo ne change pas.");
      const v = x.dice(me, 100);
      if (v === 1) {
        if (x.p(me).terrain.includes(ORAGE)) x.gain(me, 500);
        else summonStorm(x, me);
      } else if (v === 100) x.gain(me, 250);
      else if (v === 50) for (const u of x.others(me)) if (!x.p(u).out) x.transfer(me, u, 50);
      else x.log("Les prières restent sans réponse.");
    },
  },

  // Temporiser (passif) : au début de ton tour, si ta sentience est vraie, tu peux payer selon ta météo pour un effet
  "MET-23": {
    activate: (x, { id, me }) => {
      const self = { id, me };
      if (!x.p(me).sentience) {
        x.reason = "Ta sentience est fausse.";
        return false;
      }
      const w = x.weather(me);
      const cost: Partial<Record<Weather, [number, string]>> = {
        Pluie: [20, "changer la position d'une carte"],
        "Vent violent": [200, "échanger les terrains de deux joueurs"],
        Canicule: [100, "changer le trou noir d'un joueur"],
        Neige: [50, "défausser la carte de n'importe qui"],
        Grêle: [20, "empêcher une carte de se jouer à son prochain passage"],
      };
      const c = w ? cost[w] : undefined;
      if (!c) {
        x.reason = `Rien à faire avec ta météo (${weatherLabel(w)}).`;
        return false;
      }
      if (!x.canPay(me, c[0])) {
        x.reason = `Il faut ${c[0]} gold.`;
        return false;
      }
      if (!x.confirm(me, `Temporiser (${w}) : payer ${c[0]} gold pour ${c[1]} ?`, self.id)) return x.log("Temporiser : rien n'est fait.");
      if (!x.spend(me, c[0])) return false;
      const all = x.turnOrder().filter((u) => !x.p(u).out);
      if (w === "Pluie") {
        const m = x.chooseCard(me, "Temporiser : quelle carte déplacer ?", x.allTerrainCards(), self.id);
        const u = m ? E.locate(x.g, m)?.uid : null;
        if (m && u)
          x.move(m, {
            uid: u,
            zone: "terrain",
            index: x.chooseSlot(me, `Nouvelle place de « ${card(m).name} » ?`, u, m, self.id),
          });
      } else if (w === "Vent violent") {
        const a = x.choosePlayer(me, "Temporiser : premier terrain à échanger ?", all, self.id);
        const b =
          a &&
          x.choosePlayer(
            me,
            "Temporiser : avec quel terrain ?",
            all.filter((u) => u !== a),
            self.id,
          );
        if (a && b) {
          const ta = x.p(a).terrain;
          x.p(a).terrain = x.p(b).terrain;
          x.p(b).terrain = ta;
          x.log(`🌬️ ${x.name(a)} et ${x.name(b)} échangent leurs terrains.`);
          x.interact(a, "terrain");
          x.interact(b, "terrain");
        }
      } else if (w === "Canicule") {
        const u = x.choosePlayer(me, "Temporiser : le trou noir de qui changer ?", all, self.id);
        if (u) x.setBlackHole(u, x.chooseBlackHole(me, `Nouveau trou noir de ${x.name(u)} ?`, x.p(u).blackHole, self.id));
      } else if (w === "Neige") {
        const m = x.chooseCard(
          me,
          "Temporiser : quelle carte défausser ?",
          x.allTerrainCards().filter((c) => c !== self.id),
          self.id,
        );
        if (m) x.discard(m);
      } else {
        const m = x.chooseCard(
          me,
          "Temporiser : quelle carte geler ?",
          x.allTerrainCards().filter((c) => !x.isDisabled(c)),
          self.id,
        );
        if (m) skipNextPlay(x, m);
      }
    },
  },

  // Indice de temps : selon la météo d'un joueur tiré au hasard, change le trou noir de la cible
  "MET-24": {
    activate: (x, { id, me }) => {
      const src = x.randomPlayer(x.turnOrder().filter((u) => !x.p(u).out && x.weather(u)));
      if (!src) {
        x.reason = "Personne n'a de météo (Beau temps partout).";
        return false;
      }
      const w = x.weather(src)!;
      if (w === "Orage") {
        x.log("⛈️ Orage : le trou noir de tout le monde est tiré au hasard.");
        for (const u of x.turnOrder()) if (!x.p(u).out) x.setBlackHole(u, x.bhDice(u));
        return;
      }
      const u = x.choosePlayer(me, `Indice de temps (${w}) : le trou noir de qui changer ?`, x.turnOrder().filter((u) => !x.p(u).out), id);
      if (!u) return false;
      const map: Partial<Record<Weather, BlackHole>> = {
        Pluie: Q,
        "Vent violent": P,
        Canicule: T,
        Neige: B,
      };
      const to = map[w] ?? x.chooseBlackHole(u, "Grêle : choisis ton trou noir.", undefined, id);
      x.setBlackHole(u, to);
    },
  },

  // Albédo : à la fin de ton tour, les gold gagnés pendant ce tour sont multipliés selon ta météo au moment de la carte
  "MET-25": {
    activate: (x, { id, me }) => {
      const w = x.weather(me);
      const m = w === "Pluie" ? 1.5 : w === "Neige" ? 2 : w === "Canicule" ? 0.5 : 1;
      if (m === 1) {
        x.reason = `Multiplicateur ×1 avec ta météo (${weatherLabel(w)}).`;
        return false;
      }
      setMark(x, id, `${me}:${E.pos(x.g)}:${m}`);
      x.log(`☀️ Albédo : à la fin de ton tour, les gold gagnés ce tour seront multipliés par ${m}.`);
    },
    on: {
      turnEnd: (x, self, e) => {
        const v = x.g.marks?.[self.id];
        if (!v || e.uid !== self.me) return;
        const [uid, at, m] = v.split(":");
        if (uid !== self.me || Number(at) !== E.pos(x.g)) return;
        setMark(x, self.id, null);
        const gained = x.p(self.me).goldGainedSince ?? 0;
        const delta = Math.trunc(gained * Number(m)) - gained;
        x.triggered(self, `${gained} gold gagnés ce tour × ${m}.`);
        if (delta > 0) x.gain(self.me, delta);
        else if (delta < 0) x.lose(self.me, -delta);
      },
    },
  },

  // Nuage : 1d100 × multiplicateur de ta météo ; 50 % de le répartir entre tous les joueurs
  "MET-26": {
    activate: (x, { me }) => {
      const w = x.weather(me);
      const mult: Record<string, number> = {
        Pluie: 1.5,
        "Vent violent": 2,
        Canicule: 0,
        Neige: 0.5,
        Grêle: -1,
        Orage: -2,
      };
      const m = w ? mult[w] : 1;
      const v = Math.trunc(x.dice(me, 100) * m);
      x.log(`☁️ Nuage : ${v} gold (×${m}, ${weatherLabel(w)}).`);
      const all = x.turnOrder().filter((u) => !x.p(u).out);
      const share = x.dice(me, 2) === 1;
      const each = share ? Math.trunc(v / all.length) : v;
      if (share) x.log(`Les ${v > 0 ? "gains" : "coûts"} sont répartis : ${each} chacun.`);
      for (const u of share ? all : [me]) {
        if (each > 0) x.gain(u, each);
        else if (each < 0) x.lose(u, -each);
      }
    },
  },

  // Météo photoshoppée : deux joueurs à la même météo peuvent jouer une carte de l'autre au début de leur tour
  "MET-27": {
    activate: (x, self) => {
      if (!photoshop(x, self, self.me)) {
        x.reason = "Aucun autre joueur n'a ta météo, ou aucune carte choisie.";
        return false;
      }
    },
    on: {
      turnStart: (x, self, e) => {
        if (x.p(e.uid)?.out) return;
        photoshop(x, self, e.uid);
      },
    },
  },

  // Météo étrange : selon ta météo
  "MET-28": {
    activate: (x, { id, me }) => {
      const w = x.weather(me);
      const all = x.turnOrder().filter((u) => !x.p(u).out);
      if (w === "Pluie") {
        const rainy = all.filter((u) => x.weather(u) === "Pluie");
        if (!x.confirm(me, `Météo étrange : inverser la sentience des joueurs sous la pluie (${rainy.map((u) => x.name(u)).join(", ")}) ?`, id)) return;
        for (const u of rainy) x.invertSentience(u);
      } else if (w === "Vent violent") {
        for (let k = 0; k < 2; k++) {
          const i = x.chooseOption(me, `Météo étrange (${k + 1}/2) : qui lance le dé trou noir ?`, ["Personne", ...all.map((u) => x.name(u))], id);
          if (!i) break;
          x.setBlackHole(all[i - 1], x.bhDice(all[i - 1]));
        }
      } else if (w === "Neige") {
        const u = x.choosePlayer(me, "Météo étrange : à qui retirer des gold ?", all, id);
        if (u) x.lose(u, x.chooseNumber(me, `Combien retirer à ${x.name(u)} (jusqu'à 20) ?`, 0, 20, id));
      } else if (w === "Grêle") {
        const prev = E.neighbours(x.g, me)[1];
        x.setBlackHole(me, x.chooseBlackHole(prev, `Météo étrange : ${x.name(prev)}, choisis le nouveau trou noir de ${x.name(me)}.`, undefined, id));
        if (prev !== me) x.setBlackHole(prev, x.chooseBlackHole(prev, "Météo étrange : et ton nouveau trou noir ?", undefined, id));
      } else if (w === "Orage") {
        for (const u of x.others(me)) if (!x.p(u).out) x.transfer(u, me, 25);
      } else {
        x.reason = `Rien ne se passe (ta météo : ${weatherLabel(w)}).`;
        return false;
      }
    },
  },

  // Éclaircissement : sous l'orage ou la grêle, choisis ton trou noir ; la météo suit et l'Orage quitte ton terrain
  "MET-29": {
    activate: (x, { id, me }) => {
      if (!need(x, me, "Orage", "Grêle")) return false;
      const to = x.chooseBlackHole(me, "Éclaircissement : ton nouveau trou noir ?", undefined, id);
      x.setBlackHole(me, to);
      if (x.p(me).terrain.includes(ORAGE)) x.move(ORAGE, { uid: x.g.owner[ORAGE] ?? me, zone: "discard" });
      x.setWeather(me, BH_WEATHER[to]);
    },
  },

  // Éclair : seulement s'il y a un Orage ; tombe sur son terrain, chaque carte a 50 % d'aller dans la défausse
  // (5 % qu'elle se joue au lieu d'être défaussée). Para-Tonnerre bloque tout et rapporte 1d100 × 10 gold.
  "MET-30": {
    activate: (x, { id, me }) => {
      const at = E.locate(x.g, ORAGE);
      if (at?.zone !== "terrain") {
        x.reason = "Il n'y a pas d'Orage sur les terrains.";
        return false;
      }
      const u = at.uid;
      if (E.locate(x.g, id)?.uid !== u || E.locate(x.g, id)?.zone !== "terrain") x.move(id, { uid: u, zone: "terrain" });
      x.log(`⚡ L'éclair frappe le terrain de ${x.name(u)} !`, { to: u });
      if (x.active("MET-31", u)) {
        x.log("⚡ Para-Tonnerre attire la foudre : aucune carte n'est touchée.", { src: "MET-31" });
        x.runAs("MET-31", u, () => x.gain(u, x.dice(u, 100) * 10));
        return;
      }
      for (const c of x.p(u).terrain.filter((c) => c !== ORAGE && c !== id)) {
        if (x.dice(u, 2) !== 1) continue;
        if (x.dice(u, 20) === 1) {
          x.log(`✨ « ${card(c).name} » échappe à l'éclair et se joue !`, {
            dst: c,
          });
          x.activateCard(c, u);
        } else x.discard(c);
      }
    },
  },

  // Para-Tonnerre (passif) : géré par Éclair.
  "MET-31": {},

  // Bulletin météo : sentience vraie → récupère une carte Météo face visible (terrain, défausse, main révélée) et la pose sans effet ;
  // fausse → ta sentience passe à vraie
  "MET-32": {
    activate: (x, { id, me }) => {
      if (!x.p(me).sentience) {
        x.setSentience(me, true);
        return;
      }
      const visible = (c: string) => {
        const at = E.locate(x.g, c);
        return !!at && (at.zone === "terrain" || at.zone === "discard" || (at.zone === "hand" && (x.g.revealed ?? []).includes(c)));
      };
      const pool = x.turnOrder()
        .flatMap((u) => [...x.p(u).terrain, ...x.p(u).discard, ...x.p(u).hand])
        .filter((c) => c.startsWith("MET-") && c !== id && c !== ORAGE && visible(c));
      const [c] = x.chooseCards(me, "Bulletin météo : récupérer une carte Météo et la poser sur ton terrain (sans son effet) ?", pool, 0, 1, id);
      if (!c) {
        if (!pool.length) {
          x.reason = "Aucune carte Météo face visible à récupérer.";
          return false;
        }
        return x.log("Bulletin météo : aucune carte récupérée.");
      }
      if (x.move(c, { uid: me, zone: "terrain" }, { activate: false })) x.take(c, me);
    },
  },
};
