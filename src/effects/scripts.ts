import type { CardScript } from "./runtime";
import { GOBLIN } from "./goblin";
import { POPO } from "./popo";

/** Toutes les cartes automatisées, par ID. Une carte absente reste en mode manuel. */
export const SCRIPTS: Record<string, CardScript> = {
  ...GOBLIN,
  ...POPO,
};
