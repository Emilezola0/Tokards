// Un deck n'est jouable que s'il est complet (au moins MIN_DECK cartes) et entièrement automatisé.
import { BASE_DECK, DECKS, type DeckDef } from "../data/cards";
import { isAutoVC } from "../game/victory";
import { SCRIPTS } from "./scripts";

export const MIN_DECK = 10;

export type DeckStatus = { ready: boolean; auto: number; total: number; why?: string };

export function deckStatus(d: DeckDef): DeckStatus {
  const total = d.cards.length;
  const auto = d.cards.filter((id) => SCRIPTS[id]).length;
  let why: string | undefined;
  if (total < MIN_DECK) why = `${total}/${MIN_DECK} cartes minimum`;
  else if (auto < total) why = `${auto}/${total} cartes automatisées`;
  else if (!d.vcs.some(isAutoVC)) why = "aucune condition de victoire automatisée";
  else if (!d.inGame) why = "désactivé dans le tableau";
  return { ready: !why, auto, total, why };
}

/**
 * Decks affichés dans le salon : les jouables d'abord, puis ceux « en cours ».
 * Calculé à chaque appel : l'Atelier peut changer les decks après le chargement du site.
 */
export const lobbyDecks = () => DECKS.filter((d) => d.name !== BASE_DECK && d.cards.length)
  .map((d) => ({ deck: d, status: deckStatus(d) }))
  .sort((a, b) => +b.status.ready - +a.status.ready || b.status.auto / b.status.total - a.status.auto / a.status.total);
