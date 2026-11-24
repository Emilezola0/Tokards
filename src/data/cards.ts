import raw from "./cards.json";

export type Tags = { sentience: boolean; gold: boolean; blackHole: boolean };
export type CardDef = {
  id: string;
  kind: "card" | "victory";
  deck: string;
  name: string;
  tags: Tags;
  trigger: string;
  event: string;
  target: string;
  check: string;
  text: string;
  /** colonne « Précisions (règles) » du tableau */
  rules?: string;
  image: string;
  /** colonne « Changé par Claude » : « ✏️ Modifiée v… » ou « 🆕 Ajoutée v… » (vide sinon) */
  claude?: string;
};
export type DeckDef = {
  name: string;
  code: string;
  inGame: boolean;
  color: string;
  description: string;
  /** mots-clés et résumé du gameplay (onglet Decks du tableau) */
  keywords?: string[];
  summary?: string;
  /** Facile / Moyen / Difficile (onglet Decks du tableau) */
  difficulty?: string;
  /** image du dos des cartes (fichier dans data/images) */
  back?: string;
  cards: string[];
  vcs: string[];
};
export type GlossaryEntry = { term: string; cat: string; def: string; example: string; anim: string; words: string[] };

const data = raw as unknown as { decks: DeckDef[]; cards: Record<string, CardDef>; glossary?: GlossaryEntry[] };

export const CARDS = data.cards;
export const DECKS = data.decks;
export const GLOSSARY = data.glossary ?? [];
export const BASE_DECK = "BASE";
/** Decks qu'un joueur peut choisir : complets et marqués « Dans le jeu ». */
export const PLAYABLE_DECKS = DECKS.filter((d) => d.inGame && d.name !== BASE_DECK);
export const BASE_VCS = DECKS.find((d) => d.name === BASE_DECK)?.vcs ?? [];

/** Logo des cartes changées ou ajoutées par Claude (null si la carte est d'origine). */
export function claudeMark(c: CardDef): { icon: string; label: string } | null {
  if (!c.claude) return null;
  const added = c.claude.includes("Ajout");
  const what = c.claude.replace(/^\S+\s*/, "").replace(/^(Modifiée|Ajoutée)/, "$1 par Claude");
  const undo = added ? "nouvelle carte, à retirer de l'Excel pour revenir en arrière" : "ancienne version dans l'Excel (« Avant le changement »)";
  return { icon: added ? "🆕" : "✏️", label: `${what} — ${undo}` };
}

export function card(id: string): CardDef {
  return (
    CARDS[id] ?? {
      id, kind: "card", deck: "?", name: id, tags: { sentience: false, gold: false, blackHole: false },
      trigger: "", event: "", target: "", check: "", text: "Carte inconnue", image: "",
    }
  );
}

// BASE_URL = "./" : le site marche à la racine (Firebase) comme dans un sous-dossier (GitHub Pages).
const BASE = import.meta.env?.BASE_URL ?? "/";
export const PLACEHOLDER = `${BASE}cards/placeholder.svg`;

/** Une image peut être un lien (https://…) : elle est alors chargée telle quelle, sans fichier dans le projet. */
const isUrl = (s: string) => /^https?:\/\//i.test(s);

/**
 * Fichiers remplacés depuis l'Atelier (images, voix, sons) : clé → lien local (blob:).
 * Clés : `card~<ID>`, `voice~<ID>`, `back~<CODE deck>`, `sfx~<nom>`. Rempli par overrides.ts.
 */
export const CUSTOM_URLS: Record<string, string> = {};

export function cardImage(id: string): string {
  return CUSTOM_URLS[`card~${id}`] ?? defaultCardImage(id);
}

/** Image d'origine de la carte (sans le remplacement de l'Atelier). */
export function defaultCardImage(id: string): string {
  const img = CARDS[id]?.image;
  if (!img) return PLACEHOLDER;
  return isUrl(img) ? img : `${BASE}cards/${id}.webp`;
}

/** Image du dos des cartes d'un deck (null = dos dessiné par défaut). */
export function deckBack(deck?: string): string | null {
  const d = DECKS.find((x) => x.name === deck);
  if (d && CUSTOM_URLS[`back~${d.code}`]) return CUSTOM_URLS[`back~${d.code}`];
  return defaultDeckBack(deck);
}

/** Dos d'origine d'un deck (sans le remplacement de l'Atelier). */
export function defaultDeckBack(deck?: string): string | null {
  const d = DECKS.find((x) => x.name === deck);
  if (!d?.back) return null;
  return isUrl(d.back) ? d.back : `${BASE}cards/${d.back.replace(/\.[^.]+$/, "")}.webp`;
}

export function tagIcons(t: Tags): string {
  return `${t.sentience ? "🧠" : ""}${t.gold ? "💰" : ""}${t.blackHole ? "🌀" : ""}`;
}
