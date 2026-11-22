import { card } from "../data/cards";
import * as E from "../game/engine";
import type { GameState, Room } from "../game/types";
import { BH_SYMBOL, weatherIcon, type BlackHole, type Weather } from "../game/types";

/** Valeur gardée par une carte : `short` s'affiche sur la carte, `label` / `details` dans son détail. */
export type Stored = { short: string; label: string; details: string[] };

const num = (v: string | number | undefined) => Number(v ?? 0) || 0;

/**
 * Ce qu'une carte garde en mémoire (gold de côté, compteur de tours, prévision…), lisible par les joueurs.
 * Renvoie null si la carte ne garde rien en ce moment.
 */
export function storedOf(room: Room, g: GameState, id: string): Stored | null {
  const name = (u: string | undefined) => (u ? E.nameOf(room, u) : "?");
  const store = g.cardStore?.[id] ?? 0;
  const mark = g.marks?.[id];
  const at = E.locate(g, id);
  // Compteurs qui ne veulent rien dire hors du terrain
  if ((id === "REV-01" || id === "MET-01") && at?.zone !== "terrain") return null;
  switch (id) {
    // Rêveur : compteur de tours avant le rêve
    case "REV-01": {
      if (mark === "rêve") return { short: "💤 rêve", label: "En train de rêver", details: ["Sentience vraie jusqu'à la fin du tour de son joueur."] };
      const left = 3 - (store % 3);
      return { short: `💤 ${store}/3`, label: `Rêve dans ${left} tour${left > 1 ? "s" : ""}`, details: [`Tours comptés : ${store} sur 3. Au 3e tour de son joueur, sa sentience passe à vraie.`] };
    }
    // Trace de pneu, Temps Pie : gold mis de côté sous la Neige
    case "MET-08":
    case "MET-16": {
      const n = num(mark);
      if (!n) return null;
      return {
        short: `💰 ${n}`, label: `${n} gold de côté`,
        details: [id === "MET-08" ? "Récupérés par son joueur quand sa Neige s'arrête." : "Rendus quand la Neige s'arrête, perdus si la météo passe à Grêle ou Orage."],
      };
    }
    // Orage : tours passés en jeu
    case "MET-21": {
      if (mark === undefined) return null;
      const n = num(mark);
      return { short: `⏳ ${n}/5`, label: `${n} tour${n > 1 ? "s" : ""} sur 5`, details: [`L'orage se dissipe au bout de 5 fins de tour (encore ${5 - n}).`] };
    }
    // Météo : chance du trou noir favorisé, propre à chaque joueur
    case "MET-01": {
      const u = at?.uid ?? g.owner[id];
      if (!u) return null;
      const pct = Math.min(100, 40 + 20 * num(g.marks?.[`MET-01:miss:${u}`]));
      return { short: `🎯 ${pct} %`, label: `Trou noir favorisé : ${pct} %`, details: [`Chance actuelle de ${name(u)} d'obtenir le trou noir favorisé (+20 % après chaque échec, 40 % après une réussite).`] };
    }
    // Présentateur météo : les prévisions faites
    case "MET-12": {
      if (!mark) return null;
      try {
        const { by, pred } = JSON.parse(mark) as { by: string; pred: Record<string, string> };
        return { short: "📺 prévu", label: "Prévisions en cours", details: [`Faites par ${name(by)}, vérifiées au début de son prochain tour :`, ...Object.entries(pred).map(([u, w]) => `· ${name(u)} : ${w}`)] };
      } catch {
        return null;
      }
    }
    // Indice de temps : changement de trou noir programmé
    case "MET-24": {
      if (!mark) return null;
      const [u, bh, due] = mark.split("|");
      const left = Math.max(0, num(due) - E.pos(g));
      return {
        short: `🔮 ${BH_SYMBOL[bh as BlackHole] ?? ""}`, label: `Prévision : ${name(u)} → ${bh}`,
        details: [`${name(u)} passera en ${bh} dans ${left} tour${left > 1 ? "s" : ""} ; d'ici là, son trou noir est figé.`],
      };
    }
    // Nuage : la météo choisie
    case "MET-26": {
      if (!mark) return null;
      return { short: `☁️ ${weatherIcon(mark as Weather)}`, label: `Nuage : ${mark}`, details: [`Les cartes placées après Nuage sur ce terrain voient la météo ${mark}.`] };
    }
  }
  if (store) return { short: `💰 ${store}`, label: `Réserve : ${store} gold`, details: [`Gold stockés sur « ${card(id).name} » par son effet.`] };
  return null;
}
