import { Fragment, useMemo } from "react";
import { GLOSSARY, type GlossaryEntry } from "../data/cards";
import * as E from "../game/engine";
import type { GameState } from "../game/types";
import { weatherLabel } from "../game/types";

/** États en cours d'un joueur qui décident quelle partie d'un texte s'applique (météo, 2e météo, sentience). */
export function activeTerms(g: GameState | null | undefined, uid: string | null | undefined): string[] | undefined {
  const p = uid ? g?.players[uid] : undefined;
  if (!g || !uid || !p) return undefined;
  const out = [p.sentience ? "🧠 vraie" : "🧠 fausse"];
  if (g.meteo) {
    const w = E.weatherOf(g, uid);
    out.push(weatherLabel(w));
    if (p.weather2 && w !== "Orage") out.push(p.weather2);
  }
  return out;
}
/** Début d'un passage conditionnel : « Sous la Pluie : », « Canicule : », « 🧠 vraie : »… */
const COND = /^\s*(?:Sous (?:la |le |l'))?(Pluie|Vent violent|Canicule|Neige|Grêle|Orage|Beau temps|🧠 vraie|🧠 fausse)\b/i;

/** Ouvre le glossaire illustré sur un terme (écouté par Glossary.tsx). */
export const openGlossary = (term?: string) => dispatchEvent(new CustomEvent("tokards:glossary", { detail: term ?? null }));

const CAT_CLASS: Record<string, string> = {
  Action: "act", Ressource: "res", Carte: "card", Zone: "zone", Joueur: "player", Règle: "rule",
};
export const catClass = (cat: string) => CAT_CLASS[cat] ?? "act";

// Variantes du glossaire, les plus longues d'abord (« trou de ver » avant « trou »).
const WORDS: { w: string; e: GlossaryEntry }[] = GLOSSARY.flatMap((e) => e.words.map((w) => ({ w, e }))).sort((a, b) => b.w.length - a.w.length);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RE = WORDS.length ? new RegExp(`(?<![\\p{L}\\d-])(${WORDS.map((x) => esc(x.w)).join("|")})(?![\\p{L}\\d-])`, "giu") : null;
const BY_WORD = new Map(WORDS.map((x) => [x.w.toLowerCase(), x.e]));

/** Texte de carte avec les mots du glossaire en couleur (survol = définition, clic = glossaire). */
export default function KwText({ text, className = "", active }: { text: string; className?: string; active?: string[] }) {
  // Avec `active` : chaque passage « X : … » (ligne ou morceau séparé par « · ») est mis en avant s'il s'applique
  // maintenant au joueur, et estompé sinon.
  if (active?.length && text) {
    const low = active.map((a) => a.toLowerCase());
    const chunks = text.split(/(\n| · |(?<=\.) (?=Sous |🧠 vraie|🧠 fausse|Sinon))/u);
    return (
      <span className={`kw-text ${className}`}>
        {chunks.map((ch, i) => {
          const m = COND.exec(ch);
          if (!m) return <Plain key={i} text={ch} />;
          const on = low.includes(m[1].toLowerCase());
          return (
            <span key={i} className={on ? "kw-on" : "kw-off"} title={on ? "S'applique maintenant" : "Ne s'applique pas maintenant"}>
              <Plain text={ch} />
            </span>
          );
        })}
      </span>
    );
  }
  return <Plain text={text} className={className} />;
}

function Plain({ text, className = "" }: { text: string; className?: string }) {
  const parts = useMemo(() => {
    if (!RE || !text) return [text];
    const out: (string | { s: string; e: GlossaryEntry })[] = [];
    let last = 0;
    for (const m of text.matchAll(RE)) {
      const e = BY_WORD.get(m[0].toLowerCase());
      if (!e) continue;
      if (m.index! > last) out.push(text.slice(last, m.index));
      out.push({ s: m[0], e });
      last = m.index! + m[0].length;
    }
    out.push(text.slice(last));
    return out;
  }, [text]);
  return (
    <span className={`kw-text ${className}`}>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <Fragment key={i}>{p}</Fragment>
        ) : (
          <span
            key={i}
            className={`kw kw-${catClass(p.e.cat)}`}
            title={`${p.e.term} : ${p.e.def}`}
            onClick={(ev) => {
              ev.stopPropagation();
              openGlossary(p.e.term);
            }}
          >
            {p.s}
          </span>
        ),
      )}
    </span>
  );
}
