import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { GLOSSARY } from "../data/cards";
import { sfx } from "./sfx";

// Boutons flottants présents sur tous les écrans (guide, glossaire, nouveautés).
// Leurs fenêtres sont lourdes (illustrations, textes des versions) : elles sont chargées seulement à l'ouverture,
// pour que l'accueil s'affiche plus vite.
const HelpGuide = lazy(() => import("./HelpGuide"));
const Glossary = lazy(() => import("./Glossary"));
const PatchNotes = lazy(() => import("./PatchNotes"));

const SEEN = "tokards.patchSeen";
const readSeen = () => {
  try {
    return localStorage.getItem(SEEN);
  } catch {
    return null;
  }
};
export const markPatchSeen = (version: string) => {
  try {
    localStorage.setItem(SEEN, version);
  } catch {
    /* stockage indisponible */
  }
};
const idle = (cb: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(cb) : setTimeout(cb, 1500));

export default function Overlays() {
  const [help, setHelp] = useState(false);
  const [gloss, setGloss] = useState<{ term: string | null; n: number } | null>(null);
  const [patch, setPatch] = useState(false);
  const [fresh, setFresh] = useState(false);
  const closeHelp = useCallback(() => setHelp(false), []);
  const closeGloss = useCallback(() => setGloss(null), []);
  const closePatch = useCallback(() => setPatch(false), []);

  // Les mots-clés des cartes ouvrent le glossaire sur leur définition (voir KwText).
  useEffect(() => {
    const h = (e: Event) => setGloss((g) => ({ term: (e as CustomEvent<string | null>).detail, n: (g?.n ?? 0) + 1 }));
    addEventListener("tokards:glossary", h);
    return () => removeEventListener("tokards:glossary", h);
  }, []);
  // Pastille « nouveau » : on charge les patch notes en tâche de fond pour connaître leur dernière version.
  useEffect(() => {
    idle(() => void import("./PatchNotes").then((m) => setFresh(readSeen() !== m.latest)));
  }, []);

  const open = (fn: () => void) => () => (sfx.click(), fn());
  return (
    <>
      <button className="help-fab" title="Comment jouer" onClick={open(() => setHelp(true))}>?</button>
      {GLOSSARY.length > 0 && (
        <button className="gloss-fab" title="Glossaire : le sens des mots des cartes" onClick={open(() => setGloss({ term: null, n: 0 }))}>📖</button>
      )}
      <button className={`patch-fab ${fresh ? "fresh" : ""}`} title="Nouveautés (patch notes)" onClick={open(() => (setFresh(false), setPatch(true)))}>
        📜
      </button>
      <Suspense fallback={null}>
        {help && <HelpGuide onClose={closeHelp} />}
        {/* `key` : un nouveau mot cliqué pendant que le glossaire est ouvert le rouvre sur ce mot. */}
        {gloss && <Glossary key={gloss.n} term={gloss.term} onClose={closeGloss} />}
        {patch && <PatchNotes onClose={closePatch} />}
      </Suspense>
    </>
  );
}
