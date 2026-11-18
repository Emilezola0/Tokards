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

export function cardImage(id: string): string {
  return CARDS[id]?.image ? `${BASE}cards/${id}.webp` : PLACEHOLDER;
}

/** Image du dos des cartes d'un deck (null = dos dessiné par défaut). */
export function deckBack(deck?: string): string | null {
  const d = DECKS.find((x) => x.name === deck);
  return d?.back ? `${BASE}cards/${d.back.replace(/\.[^.]+$/, "")}.webp` : null;
}

export function tagIcons(t: Tags): string {
  return `${t.sentience ? "🧠" : ""}${t.gold ? "💰" : ""}${t.blackHole ? "🌀" : ""}`;
}
