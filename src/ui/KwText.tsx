import { Fragment, useMemo } from "react";
import { GLOSSARY, type GlossaryEntry } from "../data/cards";

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
export default function KwText({ text, className = "" }: { text: string; className?: string }) {
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
