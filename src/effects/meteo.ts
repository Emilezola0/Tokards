// Météo — effets automatiques (rework v0.34). Chaque joueur a sa météo : Beau temps, Pluie, Vent violent, Canicule,
// Neige, Grêle ou Orage (Orage = la carte Orage est sur son terrain). Quand le deck Météo est en jeu, chacun commence
// avec une météo au hasard, puis sa météo suit son trou noir (Blazard Pluie · Quasar Vent violent · Trou de ver Canicule ·
// Primordial Grêle) ; la Neige ne vient que des cartes. Un thème par météo : Pluie = pioche et main, Vent violent =
// déplacements, Canicule = gold et paris, Neige = accumuler et geler, Grêle = chaos, Orage = blocage.
// Les choix d'interprétation sont notés dans l'onglet « Interprétations » du tableau et dans docs/interpretations-validees.md.
import { card } from "../data/cards";
import * as E from "../game/engine";
import type { BlackHole, Weather } from "../game/types";
import { BH_WEATHER, weatherIcon, weatherLabel } from "../game/types";
import type { CardScript, Ctx } from "./runtime";

const ORAGE = E.ORAGE;
/** Météos qu'une carte peut choisir ou tirer (l'Orage ne vient que de sa carte). */
const SKY: Weather[] = ["Pluie", "Vent violent", "Canicule", "Neige", "Grêle"];
/** Trou noir associé à chaque météo (inverse de BH_WEATHER ; pas de trou noir pour la Neige). */
const WEATHER_BH: Partial<Record<Weather, BlackHole>> = { Pluie: "Blazard", "Vent violent": "Quasar", Canicule: "Trou de ver", Grêle: "Primordial" };
/** Trou noir favorisé : 40 % de chances, +20 % à chaque échec, remis à 40 % une fois obtenu. */
const FAV_BASE = 40;
const FAV_STEP = 20;

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

const alive = (x: Ctx) => x.turnOrder().filter((u) => !x.p(u).out);
/** Joueurs encore en jeu qui ont la météo `w`. */
const under = (x: Ctx, w: Weather) => alive(x).filter((u) => x.isWeather(u, w));
const wxText = (w: Weather | null) => `${weatherIcon(w)} ${weatherLabel(w)}`;

/**
 * Météo utilisée par une carte à plusieurs cas : la météo du joueur, ou sa 2e météo (Météo étrange) s'il en a une
 * qui sert aussi — il choisit alors laquelle appliquer.
 */
function pickWx(x: Ctx, me: string, id: string, useful: Weather[]): Weather | null {
  const main = x.weather(me);
  const second = main !== "Orage" ? x.p(me).weather2 ?? null : null;
  const opts = [main, second].filter((w, i, a): w is Weather => !!w && useful.includes(w) && a.indexOf(w) === i);
  if (opts.length < 2) return opts[0] ?? main;
  return opts[x.chooseOption(me, "Météo étrange : quelle météo utiliser pour cette carte ?", opts.map(wxText), id)];
}


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

/** Inverse l'ordre du terrain de `u` (la carte `keep` garde sa place). */
function invertTerrain(x: Ctx, u: string, keep: string) {
  if (x.p(u).terrain.length < 2 || !x.canReorder(u)) return;
  const t = x.p(u).terrain;
  const k = t.indexOf(keep);
  const rest = t.filter((c) => c !== keep).reverse();
  if (k >= 0) rest.splice(k, 0, keep);
  x.p(u).terrain = rest;
  x.log(`🌬️ Mistrale : l'ordre du terrain de ${x.name(u)} s'inverse.`, { src: "MET-04", to: u });
  x.interact(u, "terrain");
}

/** Neige parfaite : la carte gèle (désactivée) jusqu'au prochain changement de météo de `uid`. */
function freeze(x: Ctx, c: string, uid: string) {
  if (c === ORAGE || E.locate(x.g, c)?.zone !== "terrain" || x.g.disabled?.[c]) return;
  x.log(`❄️ « ${card(c).name} » gèle jusqu'au prochain changement de météo de ${x.name(uid)}.`, { src: "MET-06", dst: c });
  if (x.disable(c) && x.g.disabled?.[c]) x.g.frozen = { ...(x.g.frozen ?? {}), [c]: uid };
}

/** Neige parfaite : une carte arrive sur le terrain de `u` ; sous la Neige, 20 % qu'elle gèle. */
function snowLanding(x: Ctx, self: string, c: string, u: string) {
  if (c === self || c === ORAGE || x.p(u)?.out || !x.isWeather(u, "Neige") || x.isWeather(u, "Canicule") || E.locate(x.g, c)?.zone !== "terrain") return;
  if (x.chance(u, 20, [`« ${card(c).name} » gèle`, "pas de gel"])) freeze(x, c, u);
}

/** Change la météo de `me` en passant par son trou noir (la météo suit le trou noir) ; Neige / Beau temps : directement. */
function goWeather(x: Ctx, me: string, w: Weather | null) {
  const bh = w ? WEATHER_BH[w] : undefined;
  if (bh && x.p(me).blackHole !== bh) {
    x.setBlackHole(me, bh);
    if (x.p(me).blackHole === bh) return;
  }
  x.setWeather(me, w);
}

export const METEO: Record<string, CardScript> = {
  // Météo : dé trou noir avec un trou noir favorisé (40 %, +20 % à chaque échec, remis à 40 % une fois obtenu) ;
  // la météo du lanceur suit le résultat.
  "MET-01": {
    activate: (x, { id, me }) => {
      const key = `MET-01:miss:${me}`;
      const pct = Math.min(100, FAV_BASE + FAV_STEP * num(x, key));
      const fav = x.chooseBlackHole(me, `Météo : quel trou noir favoriser (${pct} % de chances) ?`, undefined, id);
      const b = x.bhDiceFav(me, fav, pct);
      if (b === fav) setMark(x, key, null);
      else {
        setMark(x, key, num(x, key) + 1);
        x.log(`Météo : raté, ${fav} aura ${Math.min(100, pct + FAV_STEP)} % la prochaine fois.`);
      }
      if (x.p(me).blackHole !== b) x.setBlackHole(me, b);
      if (x.p(me).blackHole === b && x.weather(me) !== BH_WEATHER[b]) x.setWeather(me, BH_WEATHER[b]);
    },
  },

  // Météo pays : pour 20 gold, chaque autre joueur favorise un trou noir puis lance le dé (jamais son trou noir actuel)
  "MET-02": {
    activate: (x, { id, me }) => {
      const others = alive(x).filter((u) => u !== me);
      if (!others.length) {
        x.reason = "Aucun autre joueur.";
        return false;
      }
      if (!x.canPay(me, 20)) {
        x.reason = "Il faut 20 gold.";
        return false;
      }
      if (!x.confirm(me, "Météo pays : payer 20 gold pour que chaque autre joueur change de trou noir ?", id)) return x.log("Météo pays : rien ne change.");
      if (!x.spend(me, 20)) return false;
      for (const u of others) {
        const cur = x.p(u).blackHole;
        const fav = x.chooseBlackHole(u, `Météo pays : quel nouveau trou noir favoriser (${FAV_BASE} % de chances) ?`, cur, id);
        const b = x.bhDiceFav(u, fav, FAV_BASE, cur);
        x.setBlackHole(u, b);
      }
    },
  },

  // Temps pluvieux : votre météo → Pluie ; si c'était déjà la Pluie, piochez 2 cartes
  "MET-03": {
    activate: (x, { me }) => {
      const was = x.isWeather(me, "Pluie");
      goWeather(x, me, "Pluie");
      if (was) x.draw(me, 2);
    },
  },

  // Mistrale (passif) : un joueur qui passe sous le Vent violent voit l'ordre de son terrain s'inverser
  // (une fois par passage ; ceux qui y sont déjà quand Mistrale arrive aussi). Mistrale garde sa place.
  "MET-04": {
    on: {
      placed: (x, self, e) => {
        if (e.card !== self.id) return;
        for (const u of under(x, "Vent violent")) if (u !== self.me) invertTerrain(x, u, self.id);
      },
      weather: (x, self, e) => {
        if (e.to !== "Vent violent" || e.from === "Vent violent" || x.p(e.uid)?.out || e.uid === self.me) return;
        invertTerrain(x, e.uid, self.id);
      },
      // Le joueur de Mistrale, lui, peut replacer jusqu'à 2 cartes de son terrain au début de son tour (sous le Vent violent).
      turnStart: (x, self, e) => {
        const me = self.me;
        if (e.uid !== me || x.p(me)?.out || !x.isWeather(me, "Vent violent") || x.p(me).terrain.length < 2 || !x.canReorder(me)) return;
        const picked = x.chooseCards(me, "Mistrale : replacer jusqu'à 2 cartes de ton terrain ? (facultatif)", [...x.p(me).terrain], 0, 2, self.id);
        if (!picked.length) return;
        x.triggered(self, `${x.name(me)} replace ${picked.length} carte${picked.length > 1 ? "s" : ""} de son terrain.`);
        for (const c of picked) {
          if (E.locate(x.g, c)?.zone !== "terrain") continue;
          const t = x.p(me).terrain;
          t.splice(t.indexOf(c), 1);
          const slot = x.chooseSlot(me, `Mistrale : où replacer « ${card(c).name} » ?`, me, c, self.id);
          t.splice(slot, 0, c);
          x.p(me).terrain = [...t];
        }
        x.interact(me, "terrain");
      },
    },
  },

  // Hot : chaque joueur sous la Canicule lance le dé de sentience ; +10 gold au lanceur par sentience changée
  "MET-05": {
    activate: (x, { me }) => {
      const who = under(x, "Canicule");
      if (!who.length) {
        x.reason = "Personne n'a la Canicule.";
        return false;
      }
      let n = 0;
      for (const u of who) {
        const before = x.p(u).sentience;
        const v = x.sentDice(u);
        if (v !== before) x.setSentience(u, v);
        if (x.p(u).sentience !== before) n++;
      }
      if (n) x.gain(me, 10 * n);
      else x.log("Hot : aucune sentience n'a changé.");
    },
  },

  // Neige parfaite (passif) : au début du tour d'un joueur sous la Neige, chaque carte de son terrain a 20 % de geler ;
  // une carte qui arrive sur son terrain a aussi 20 % de geler. Dégel au changement de météo de ce joueur.
  // Un joueur qui a aussi la Canicule (Météo étrange) n'est pas touché.
  "MET-06": {
    on: {
      // Début du tour d'un joueur sous la Neige : chaque carte de son terrain a 20 % de geler.
      turnStart: (x, self, e) => {
        if (x.p(e.uid)?.out || !x.isWeather(e.uid, "Neige") || x.isWeather(e.uid, "Canicule")) return;
        const pool = x.p(e.uid).terrain.filter((c) => c !== ORAGE && c !== self.id && !x.g.disabled?.[c]);
        if (!pool.length) return;
        const hit = pool.filter(() => x.rand() < 0.2);
        x.triggered(self, hit.length
          ? `la neige tombe sur le terrain de ${x.name(e.uid)} : ${hit.length} carte${hit.length > 1 ? "s gèlent" : " gèle"} sur ${pool.length} (20 % chacune).`
          : `la neige tombe sur le terrain de ${x.name(e.uid)} : aucune carte ne gèle (20 % chacune, ${pool.length} carte${pool.length > 1 ? "s" : ""}).`);
        for (const c of hit) freeze(x, c, e.uid);
      },
      // Toute carte qui arrive sur le terrain d'un joueur sous la Neige (posée, donnée, déplacée…) a 20 % de geler.
      placed: (x, self, e) => snowLanding(x, self.id, e.card, e.uid),
      cardMoved: (x, self, e) => {
        if (e.from.zone === "terrain" && e.to?.zone === "terrain" && e.from.uid !== e.to.uid) snowLanding(x, self.id, e.card, e.to.uid);
      },
    },
  },

  // Temps de Grêle (passif) : au début du tour d'un joueur sous la Grêle, une carte au hasard de son terrain va à la défausse
  "MET-07": {
    on: {
      turnStart: (x, self, e) => {
        if (x.p(e.uid)?.out || !x.isWeather(e.uid, "Grêle")) return;
        const pool = x.p(e.uid).terrain.filter((c) => c !== ORAGE && c !== self.id);
        if (!pool.length) return;
        const c = x.random(pool);
        x.triggered(self, `la grêle tombe sur le terrain de ${x.name(e.uid)} : « ${card(c).name} » est défaussée.`);
        x.discard(c);
      },
    },
  },

  // Trace de pneu (passif) : sous la Neige, chaque carte posée (par n'importe qui) met 5 gold de côté ici ;
  // quand la Neige s'arrête, son joueur les récupère.
  "MET-08": {
    on: {
      placed: (x, self, e) => {
        if (e.card === self.id || !x.isWeather(self.me, "Neige")) return;
        setMark(x, self.id, num(x, self.id) + 5);
        x.triggered(self, `trace dans la neige : +5 gold de côté (${num(x, self.id)}).`);
      },
      weather: (x, self, e) => {
        const n = num(x, self.id);
        if (e.uid !== self.me || e.from !== "Neige" || e.to === "Neige" || !n) return;
        setMark(x, self.id, null);
        x.triggered(self, `la neige fond : ${n} gold récupérés.`);
        x.gain(self.me, n);
      },
    },
  },

  // Hot-dog : pari jusqu'à 50 gold, 1d6 (4-6 gagné, 1-3 perdu) ; sous la Canicule, gain et perte × le nombre de joueurs
  // sous la Canicule (×2 au minimum)
  "MET-09": {
    activate: (x, { id, me }) => {
      const max = Math.min(50, x.p(me).gold);
      if (max <= 0) {
        x.reason = "Il faut au moins 1 gold pour parier.";
        return false;
      }
      const hot = x.isWeather(me, "Canicule");
      const m = hot ? Math.max(2, under(x, "Canicule").length) : 1;
      const bet = x.chooseNumber(me, `Hot-dog : combien parier (jusqu'à 50) ?${hot ? ` Canicule : gain ou perte × ${m}.` : ""}`, 0, max, id);
      if (!bet) return x.log("Hot-dog : pas de pari.");
      const v = x.dice(me, 6, (v) => (v >= 4 ? `gagné : +${bet * m} gold` : `perdu : −${bet * m} gold`));
      if (v >= 4) x.gain(me, bet * m);
      else x.lose(me, bet * m);
    },
  },

  // Ga-Doux : défaussez une carte du terrain d'un joueur sous la Pluie ; ce joueur doit poser une carte de sa main sans son effet,
  // et met de la boue sur elle et ses voisines (bloquées tant que ce joueur est sous la Pluie)
  "MET-10": {
    activate: (x, { id, me }) => {
      const rainy = under(x, "Pluie");
      const pool = rainy.flatMap((u) => x.p(u).terrain).filter((c) => c !== id && c !== ORAGE);
      if (!pool.length) {
        x.reason = "Aucune carte sur le terrain d'un joueur sous la Pluie.";
        return false;
      }
      const c = x.chooseCard(me, "Ga-Doux : quelle carte défausser (terrain d'un joueur sous la Pluie) ?", pool, id);
      if (!c) return false;
      const u = E.locate(x.g, c)!.uid;
      x.discard(c);
      // Le joueur doit poser une carte de sa main (sans son effet) : elle et ses voisines prennent de la boue.
      const hand = x.p(u).hand.filter((c) => c !== ORAGE);
      if (!hand.length) return x.log(`Ga-Doux : ${x.name(u)} n'a aucune carte à poser.`);
      const [h] = x.chooseCards(u, "Ga-Doux : pose une carte de ta main sur ton terrain (sans son effet) ; elle et ses voisines prennent de la boue.", hand, 1, 1, id);
      if (!h || !x.move(h, { uid: u, zone: "terrain", index: x.chooseSlot(u, `Où poser « ${card(h).name} » ?`, u, h, id) }, { activate: false })) return;
      const t = x.p(u).terrain;
      const i = t.indexOf(h);
      if (i < 0) return;
      const muddy = [t[i - 1], h, t[i + 1]].filter((c): c is string => !!c && c !== ORAGE);
      x.g.mud = [...new Set([...(x.g.mud ?? []), ...muddy])];
      x.log(`🟫 Ga-Doux : ${muddy.map((c) => `« ${card(c).name} »`).join(", ")} ${muddy.length > 1 ? "sont couvertes" : "est couverte"} de boue : bloquée${muddy.length > 1 ? "s" : ""} tant que ${x.name(u)} est sous la Pluie.`, { src: id, to: u });
      x.interact(u, "terrain");
    },
  },

  // Climatisation : payer (facultatif) pour une météo provisoire jusqu'à la fin de votre tour
  "MET-11": {
    activate: (x, { id, me }) => {
      const opts: [string, number, Weather | null][] = [];
      if (x.isWeather(me, "Canicule")) opts.push(["10 gold : Canicule → Beau temps", 10, null]);
      opts.push(["25 gold : Vent violent", 25, "Vent violent"], ["25 gold : Neige", 25, "Neige"]);
      const ok = opts.filter((o) => x.canPay(me, o[1]));
      if (!ok.length) {
        x.reason = "Pas assez de gold.";
        return false;
      }
      const i = x.chooseOption(me, "Climatisation : météo provisoire jusqu'à la fin de ton tour ?", ["Rien", ...ok.map((o) => o[0])], id);
      if (!i) return x.log("Climatisation : rien ne change.");
      const [, cost, w] = ok[i - 1];
      if (!x.spend(me, cost)) return false;
      x.setWeatherUntilTurnEnd(me, w);
    },
  },

  // Présentateur météo : prédit la météo de chaque autre joueur ; si tout est juste au début de votre prochain tour,
  // inversez la sentience d'un joueur de votre choix.
  "MET-12": {
    activate: (x, { id, me }) => {
      const others = alive(x).filter((u) => u !== me);
      if (!others.length) {
        x.reason = "Aucun autre joueur.";
        return false;
      }
      const all: (Weather | null)[] = [null, ...SKY, "Orage"];
      const pred: Record<string, string> = {};
      for (const u of others) pred[u] = weatherLabel(all[x.chooseOption(me, `Présentateur météo : quelle météo aura ${x.name(u)} au début de ton prochain tour ?`, all.map(wxText), id)]);
      setMark(x, id, JSON.stringify({ by: me, at: E.pos(x.g), pred }));
      x.log(`📺 Prévisions : ${others.map((u) => `${x.name(u)} ${pred[u]}`).join(" · ")}.`);
    },
    on: {
      turnStart: (x, self, e) => {
        const raw = x.g.marks?.[self.id];
        if (!raw) return;
        const m = JSON.parse(raw) as { by: string; at: number; pred: Record<string, string> };
        if (e.uid !== m.by || E.pos(x.g) <= m.at) return;
        setMark(x, self.id, null);
        const wrong = Object.entries(m.pred).filter(([u, w]) => x.p(u) && !x.p(u).out && weatherLabel(E.weatherOf(x.g, u)) !== w);
        if (wrong.length) return x.triggered(self, `prévisions fausses (${wrong.map(([u]) => x.name(u)).join(", ")}).`);
        x.triggered(self, "toutes les prévisions sont justes !");
        const u = x.choosePlayer(m.by, "Présentateur météo : inverser la sentience de qui ?", alive(x), self.id);
        if (u) x.invertSentience(u);
      },
    },
  },

  // Temps d'antenne : 5 gold par cran, la météo avance Grêle → Pluie → Vent violent → Canicule → Grêle ;
  // le trou noir suit la météo obtenue.
  "MET-13": {
    activate: (x, { id, me }) => {
      const cycle: Weather[] = ["Grêle", "Pluie", "Vent violent", "Canicule"];
      const max = Math.min(3, Math.floor(x.p(me).gold / 5));
      if (max <= 0) {
        x.reason = "Il faut 5 gold par cran.";
        return false;
      }
      const cur = x.weather(me);
      const i = cur ? cycle.indexOf(cur) : -1;
      const steps = x.chooseNumber(me, `Temps d'antenne : de combien de crans avancer (5 gold par cran) ? Ta météo : ${weatherLabel(cur)}.`, 0, max, id);
      if (!steps) return x.log("Temps d'antenne : la météo ne change pas.");
      if (!x.spend(me, 5 * steps)) return false;
      const to = cycle[i < 0 ? (steps - 1) % 4 : (i + steps) % 4];
      goWeather(x, me, to);
    },
  },

  // Temps bien que mal : échangez (facultatif) une carte de votre main avec une de votre terrain ; sous le Vent violent,
  // au choix : une carte d'un terrain tiré au hasard retourne dans la main de son joueur · la météo d'un joueur avance
  // d'un cran · prenez la carte du dessus d'une défausse (25 % d'échec : elle part sur un terrain au hasard).
  "MET-14": {
    activate: (x, { id, me }) => {
      const mine = x.p(me).terrain.filter((c) => c !== id && c !== ORAGE);
      const [h] = mine.length ? x.chooseCards(me, "Temps bien que mal : échanger une carte de ta main avec une de ton terrain ? (facultatif)", x.p(me).hand.filter((c) => c !== ORAGE), 0, 1, id) : [];
      if (h) {
        const t = x.chooseCard(me, `Contre quelle carte de ton terrain échanger « ${card(h).name} » ?`, mine, id);
        if (t) {
          const idx = x.p(me).terrain.indexOf(t);
          x.move(t, { uid: me, zone: "hand" });
          x.move(h, { uid: me, zone: "terrain", index: idx }, { activate: false });
          x.log(`🔁 « ${card(h).name} » prend la place de « ${card(t).name} », qui revient en main (sans effet).`, { dst: h });
        }
      }
      if (pickWx(x, me, id, ["Vent violent"]) !== "Vent violent") return;
      const opts = [
        "Rien",
        "Un terrain au hasard : une de ses cartes retourne dans la main de son joueur",
        "Faire avancer la météo d'un joueur d'un cran",
        "Prendre la carte du dessus d'une défausse (25 % d'échec)",
      ];
      const i = x.chooseOption(me, "Vent violent : que faire ?", opts, id);
      if (!i) return x.log("Vent violent : rien de plus.");
      x.log(`🌬️ Vent violent : ${opts[i].toLowerCase()}.`);
      if (i === 1) {
        const u = x.randomPlayer(alive(x).filter((u) => x.p(u).terrain.some((c) => c !== ORAGE && c !== id)));
        if (!u) return;
        const c = x.chooseCard(me, `Vent violent : quelle carte du terrain de ${x.name(u)} renvoyer dans sa main ?`, x.p(u).terrain.filter((c) => c !== ORAGE && c !== id), id);
        if (c) x.move(c, { uid: u, zone: "hand" });
      } else if (i === 2) {
        const u = x.choosePlayer(me, "Vent violent : la météo de qui faire avancer (Grêle → Pluie → Vent violent → Canicule → Grêle) ?", alive(x), id);
        if (!u) return;
        const cycle: Weather[] = ["Grêle", "Pluie", "Vent violent", "Canicule"];
        const k = cycle.indexOf(x.weather(u) as Weather);
        goWeather(x, u, cycle[k < 0 ? 0 : (k + 1) % 4]);
      } else {
        const piles = alive(x).filter((u) => x.p(u).discard.length);
        if (!piles.length) return x.log("Vent violent : toutes les défausses sont vides.");
        const tops = piles.map((u) => x.p(u).discard[0]);
        const c = x.chooseCard(me, "Vent violent : quelle carte du dessus d'une défausse prendre ?", tops, id);
        if (!c) return;
        if (x.chance(me, 75, ["la carte arrive dans ta main", "le vent l'emporte sur un terrain au hasard"])) {
          if (x.move(c, { uid: me, zone: "hand" })) x.take(c, me);
        } else {
          const u = x.randomPlayer(alive(x));
          if (u) x.move(c, { uid: u, zone: "terrain" }, { activate: false });
        }
      }
    },
  },

  // Temps qu'à faire : jusqu'à 2 fois, échangez une carte entre les mains de deux joueurs sous la Pluie ;
  // si vous ne faites rien, vous pouvez inverser votre sentience.
  "MET-15": {
    activate: (x, { id, me }) => {
      let done = 0;
      for (let k = 0; k < 2; k++) {
        const rainy = under(x, "Pluie").filter((u) => x.p(u).hand.length);
        if (rainy.length < 2) break;
        if (!x.confirm(me, `Temps qu'à faire (${k + 1}/2) : échanger une carte entre les mains de deux joueurs sous la Pluie ?`, id)) break;
        const a = x.choosePlayer(me, "Première main ?", rainy, id);
        const b = a && x.choosePlayer(me, "Avec la main de qui ?", rainy.filter((u) => u !== a), id);
        if (!a || !b) break;
        const ca = x.chooseCard(me, `Quelle carte de la main de ${x.name(a)} ?`, x.p(a).hand, id);
        const cb = x.chooseCard(me, `Contre quelle carte de la main de ${x.name(b)} ?`, x.p(b).hand, id);
        if (!ca || !cb) break;
        x.move(ca, { uid: b, zone: "hand" });
        x.move(cb, { uid: a, zone: "hand" });
        x.log(`🌧️ ${x.name(a)} et ${x.name(b)} échangent une carte de leur main.`);
        done++;
      }
      if (!done && x.confirm(me, "Temps qu'à faire : aucun échange. Inverser ta sentience ?", id)) x.invertSentience(me);
    },
  },

  // Temps Pie (passif) : sous la Neige, les gold perdus sont mis de côté ; quand la Neige s'arrête ils reviennent,
  // sauf si la météo passe à Grêle ou Orage (perdus).
  "MET-16": {
    on: {
      goldLost: (x, self, e) => {
        if (e.uid !== self.me || !x.isWeather(self.me, "Neige")) return;
        setMark(x, self.id, num(x, self.id) + e.amount);
        x.triggered(self, `${e.amount} gold perdus sont mis de côté (${num(x, self.id)} en réserve).`);
      },
      weather: (x, self, e) => {
        const n = num(x, self.id);
        if (e.uid !== self.me || e.from !== "Neige" || e.to === "Neige" || !n) return;
        setMark(x, self.id, null);
        if (e.to === "Grêle" || e.to === "Orage") return x.triggered(self, `${e.to} : les ${n} gold mis de côté sont perdus.`);
        x.triggered(self, `la neige fond : ${n} gold récupérés.`);
        x.gain(self.me, n);
      },
    },
  },

  // Température modérée : la météo de tous les autres joueurs devient la vôtre (pas sous l'Orage)
  "MET-17": {
    activate: (x, { me }) => {
      const w = x.weather(me);
      if (w === "Orage") {
        x.reason = "Ne marche pas sous l'Orage.";
        return false;
      }
      x.log(`🌡️ Température modérée : tout le monde passe à ${wxText(w)}.`);
      for (const u of alive(x)) if (u !== me) x.setWeather(u, w);
    },
  },

  // Temps tôt fini : sentience vraie → jouez l'effet d'une carte de votre main (elle reste en main) ; fausse → sentience vraie
  "MET-18": {
    activate: (x, { id, me }) => {
      if (!x.p(me).sentience) {
        x.setSentience(me, true);
        return;
      }
      const c = x.chooseCard(me, "Temps tôt fini : quelle carte de ta main jouer (elle reste dans ta main) ?", x.p(me).hand.filter((c) => x.canActivate(c)), id);
      if (!c) {
        x.reason = "Aucune carte de ta main à jouer.";
        return false;
      }
      x.g.revealed = [...(x.g.revealed ?? []).filter((r) => r !== c), c];
      x.noteOrigin("revealed", c);
      x.log(`👁 ${x.name(me)} montre « ${card(c).name} » et la joue depuis sa main.`, { dst: c });
      x.activateCard(c, me);
    },
  },

  // Pas Temps que ça : gagnez 1d6 × 5 gold ; sous la Grêle, un autre joueur au hasard perd autant
  "MET-19": {
    activate: (x, { me }) => {
      const n = x.dice(me, 6) * 5;
      x.gain(me, n);
      if (!x.isWeather(me, "Grêle")) return;
      const u = x.randomPlayer(alive(x).filter((u) => u !== me));
      if (u) x.lose(u, n);
    },
  },

  // Temps de merde : sous la Pluie, un orage se prépare (l'Orage prend sa place à sa prochaine activation) ; sinon météo → Pluie
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
      if (!x.isWeather(me, "Pluie")) {
        x.log("Temps de merde : pas encore de pluie, elle arrive.");
        goWeather(x, me, "Pluie");
        return;
      }
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
          x.move(self.id, { uid: x.g.owner[self.id] ?? self.me, zone: "discard" });
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

  // Temps pour prier : 1d6 — 1 l'Orage arrive chez vous (déjà là : +250) · 2-5 +20 · 6 choisissez votre météo et +50
  "MET-22": {
    activate: (x, { id, me }) => {
      const v = x.dice(me, 6, (v) => (v === 1 ? "l'Orage arrive chez vous" : v <= 5 ? "+20 gold" : "choisissez votre météo, +50 gold"));
      if (v === 1) {
        if (x.p(me).terrain.includes(ORAGE)) x.gain(me, 250);
        else summonStorm(x, me);
      } else if (v <= 5) x.gain(me, 20);
      else {
        const i = x.chooseOption(me, "Temps pour prier : ta nouvelle météo ?", SKY.map(wxText), id);
        goWeather(x, me, SKY[i]);
        x.gain(me, 50);
      }
    },
  },

  // Temporiser : payez 30 gold pour l'action de votre météo
  "MET-23": {
    activate: (x, { id, me }) => {
      const acts: Partial<Record<Weather, string>> = {
        Pluie: "piocher 2 cartes",
        "Vent violent": "déplacer une carte sur son terrain",
        Canicule: "gagner 1d6 × 10 gold",
        Neige: "désactiver une carte jusqu'à la fin de ton prochain tour",
        Grêle: "défausser une carte au hasard d'un terrain",
      };
      const w = pickWx(x, me, id, Object.keys(acts) as Weather[]);
      const what = w ? acts[w] : undefined;
      if (!w || !what) {
        x.reason = `Rien à faire avec ta météo (${weatherLabel(x.weather(me))}).`;
        return false;
      }
      if (!x.canPay(me, 30)) {
        x.reason = "Il faut 30 gold.";
        return false;
      }
      if (!x.confirm(me, `Temporiser (${w}) : payer 30 gold pour ${what} ?`, id)) return x.log("Temporiser : rien n'est fait.");
      if (!x.spend(me, 30)) return false;
      if (w === "Pluie") x.draw(me, 2);
      else if (w === "Vent violent") {
        const m = x.chooseCard(me, "Temporiser : quelle carte déplacer ?", x.allTerrainCards().filter((c) => c !== ORAGE), id);
        const u = m ? E.locate(x.g, m)?.uid : null;
        if (m && u) x.move(m, { uid: u, zone: "terrain", index: x.chooseSlot(me, `Nouvelle place de « ${card(m).name} » ?`, u, m, id) });
      } else if (w === "Canicule") x.gain(me, x.dice(me, 6) * 10);
      else if (w === "Neige") {
        const m = x.chooseCard(me, "Temporiser : quelle carte désactiver ?", x.allTerrainCards().filter((c) => c !== id), id);
        if (m) x.disable(m, x.untilEndOfNext(me));
      } else {
        const u = x.choosePlayer(me, "Temporiser : sur quel terrain faire tomber la grêle ?", alive(x).filter((u) => x.p(u).terrain.some((c) => c !== ORAGE && c !== id)), id);
        if (u) x.discard(x.random(x.p(u).terrain.filter((c) => c !== ORAGE && c !== id)));
      }
    },
  },

  // Indice de temps : choisissez un joueur et un trou noir ; il l'aura dans 2 tours de table. En attendant, cette carte est
  // désactivée et le trou noir de ce joueur ne peut pas changer. Puis la carte va à la défausse.
  "MET-24": {
    evenDisabled: true,
    activate: (x, { id, me }) => {
      if (x.g.marks?.[id]) return x.log("Indice de temps : une prévision est déjà en cours.");
      const u = x.choosePlayer(me, "Indice de temps : le trou noir de qui changer ?", alive(x), id);
      if (!u) return false;
      const bh = x.chooseBlackHole(me, `Indice de temps : quel trou noir pour ${x.name(u)} (dans 2 tours de table) ?`, undefined, id);
      const due = E.pos(x.g) + 2 * x.g.order.length;
      setMark(x, id, `${u}|${bh}|${due}`);
      x.g.bhLock = { ...(x.g.bhLock ?? {}), [u]: due };
      E.disableCard(x.g, id);
      x.log(`🔮 Indice de temps : ${x.name(u)} passera en ${bh} dans 2 tours de table ; d'ici là, son trou noir est figé.`, { dst: id, to: u });
    },
    beforeLeave: (x, self) => {
      const v = x.g.marks?.[self.id];
      if (!v) return;
      const [u] = v.split("|");
      setMark(x, self.id, null);
      const l = { ...(x.g.bhLock ?? {}) };
      delete l[u];
      x.g.bhLock = l;
    },
    on: {
      turnEnd: (x, self) => {
        const v = x.g.marks?.[self.id];
        if (!v) return;
        const [u, bh, due] = v.split("|");
        if (E.pos(x.g) < Number(due)) return;
        setMark(x, self.id, null);
        const l = { ...(x.g.bhLock ?? {}) };
        delete l[u];
        x.g.bhLock = l;
        E.enableCard(x.g, self.id);
        x.triggered(self, `la prévision tombe : ${x.name(u)} passe en ${bh}.`);
        if (x.p(u) && !x.p(u).out) x.setBlackHole(u, bh as BlackHole);
        if (E.locate(x.g, self.id)?.zone === "terrain") x.discard(self.id);
      },
    },
  },

  // Albédo : choisissez un joueur ; pendant son prochain tour, ses gains sont réduits (moitié sous la Neige, sinon −10 %)
  "MET-25": {
    activate: (x, { id, me }) => {
      const u = x.choosePlayer(me, "Albédo : quel joueur viser ?", alive(x), id);
      if (!u) return false;
      x.g.albedo = { uid: u, by: me, at: E.pos(x.g) };
      x.log(`🪞 Albédo : pendant son prochain tour, les gains de ${x.name(u)} sont réduits (moitié sous la Neige, sinon −10 %).`, { to: u });
    },
  },

  // Nuage : choisissez Pluie, Grêle ou Neige ; les cartes placées après Nuage sur son terrain voient cette météo
  "MET-26": {
    activate: (x, { id, me }) => {
      const opts: Weather[] = ["Pluie", "Grêle", "Neige"];
      const w = opts[x.chooseOption(me, "Nuage : quelle météo pour les cartes placées après Nuage ?", opts.map(wxText), id)];
      setMark(x, id, w);
      x.log(`☁️ Nuage : les cartes après Nuage sur le terrain de ${x.name(me)} voient la météo ${wxText(w)}.`);
    },
  },

  // Météo photoshoppée : copiez l'effet d'une carte Météo visible (votre main, terrains, défausses, cartes montrées)
  "MET-27": {
    activate: (x, { id, me }) => {
      const visible = (c: string) => {
        const at = E.locate(x.g, c);
        if (!at) return false;
        if (at.zone === "terrain" || at.zone === "discard") return true;
        return at.zone === "hand" && (at.uid === me || (x.g.revealed ?? []).includes(c));
      };
      const pool = alive(x)
        .flatMap((u) => [...x.p(u).terrain, ...x.p(u).discard, ...x.p(u).hand])
        .filter((c) => c.startsWith("MET-") && c !== id && c !== ORAGE && visible(c) && x.canActivate(c));
      const c = x.chooseCard(me, "Météo photoshoppée : quel effet de carte Météo copier ?", pool, id);
      if (!c) {
        x.reason = "Aucune carte Météo visible à copier.";
        return false;
      }
      x.log(`📸 Météo photoshoppée copie « ${card(c).name} ».`, { dst: c });
      x.activateCard(c, me);
    },
  },

  // Météo étrange : une 2e météo jusqu'à votre prochain changement de trou noir ; chaque carte utilise la plus utile
  "MET-28": {
    activate: (x, { id, me }) => {
      const main = x.weather(me);
      const opts = SKY.filter((w) => w !== main);
      const w = opts[x.chooseOption(me, `Météo étrange : quelle 2e météo (en plus de ${weatherLabel(main)}) ?`, opts.map(wxText), id)];
      x.p(me).weather2 = w;
      x.fx({ k: "weather", uid: me, to: w });
      x.log(`🌈 ${x.name(me)} a deux météos : ${weatherLabel(main)} et ${w} (jusqu'à son prochain changement de trou noir).`, { to: me });
      x.interact(me, "météo");
    },
  },

  // Éclaircissement : votre météo → Beau temps ; l'Orage est défaussé où qu'il soit (+50 gold s'il était chez vous).
  // Passif : sous le Beau temps, chaque fois qu'une autre de vos cartes se joue, chaque adversaire vous donne 5 gold.
  "MET-29": {
    activate: (x, { me }) => {
      const at = E.locate(x.g, ORAGE);
      const mine = at?.zone === "terrain" && at.uid === me;
      if (at?.zone === "terrain") x.move(ORAGE, { uid: x.g.owner[ORAGE] ?? me, zone: "discard" });
      x.setWeather(me, null);
      if (mine) x.gain(me, 50);
    },
    on: {
      activated: (x, self, e) => {
        if (e.uid !== self.me || e.card === self.id || !x.isWeather(self.me, null)) return;
        const opp = x.others(self.me).filter((u) => !x.p(u).out && !x.team(self.me).includes(u));
        if (!opp.length) return;
        x.triggered(self, `beau temps : « ${card(e.card).name} » se joue, chaque adversaire donne 5 gold.`);
        for (const u of opp) x.transfer(u, self.me, 5);
      },
    },
  },

  // Éclair : seulement s'il y a un Orage ; tombe sur son terrain et défausse 2 cartes au hasard (pas l'Orage).
  // Para-Tonnerre : aucune défausse, +25 gold, puis défausses volontaires à 5 gold la carte.
  "MET-30": {
    activate: (x, { id }) => {
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
        x.runAs("MET-31", u, () => {
          x.gain(u, 25);
          const skip = [ORAGE, id, "MET-31"];
          const mine = x.chooseCards(u, "Para-Tonnerre : défausser des cartes de ton terrain (+5 gold chacune) ?", x.p(u).terrain.filter((c) => !skip.includes(c)), 0, 99, "MET-31");
          for (const c of mine) {
            x.discard(c);
            if (E.locate(x.g, c)?.zone !== "terrain") x.gain(u, 5);
          }
          const theirs = x.chooseCards(u, "Para-Tonnerre : défausser des cartes des autres terrains (leur joueur gagne 5 gold par carte) ?", x.others(u).filter((o) => !x.p(o).out).flatMap((o) => x.p(o).terrain).filter((c) => !skip.includes(c)), 0, 99, "MET-31");
          for (const c of theirs) {
            const o = E.locate(x.g, c)?.uid;
            if (!o) continue;
            x.discard(c);
            if (E.locate(x.g, c)?.zone !== "terrain") x.gain(o, 5);
          }
        });
        return;
      }
      const pool = x.p(u).terrain.filter((c) => c !== ORAGE && c !== id);
      for (let k = 0; k < 2 && pool.length; k++) {
        const c = pool.splice(Math.floor(x.rand() * pool.length), 1)[0];
        x.discard(c);
      }
    },
  },

  // Para-Tonnerre (passif) : géré par Éclair.
  "MET-31": {},

  // Bulletin météo : sentience vraie → une carte Météo de votre défausse en main (pas l'Orage) ; fausse → sentience vraie.
  // Sous le Beau temps : choisissez en plus la sentience d'un adversaire.
  "MET-32": {
    activate: (x, { id, me }) => {
      if (!x.p(me).sentience) x.setSentience(me, true);
      else {
        const pool = x.p(me).discard.filter((c) => c.startsWith("MET-") && c !== ORAGE && c !== id);
        const [c] = x.chooseCards(me, "Bulletin météo : reprendre une carte Météo de ta défausse ?", pool, 0, 1, id);
        if (c) x.move(c, { uid: me, zone: "hand" });
        else x.log("Bulletin météo : aucune carte reprise.");
      }
      if (!x.isWeather(me, null)) return;
      const u = x.choosePlayer(me, "Beau temps : la sentience de quel adversaire choisir ?", alive(x).filter((o) => o !== me), id);
      if (!u) return;
      const v = x.chooseOption(me, `Sentience de ${x.name(u)} ?`, ["Vraie", "Fausse"], id) === 0;
      x.setSentience(u, v);
    },
  },
};

