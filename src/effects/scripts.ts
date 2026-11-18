import type { CardScript } from "./runtime";
import { GOBLIN } from "./goblin";
import { POPO } from "./popo";
import { FLEAUX } from "./fleaux";
import { GRENOUILLES } from "./grenouilles";
import { POLICE } from "./police";
import { EMILE } from "./emile";
import { PIRATE } from "./pirate";

/** Toutes les cartes automatisées, par ID. Une carte absente reste en mode manuel. */
export const SCRIPTS: Record<string, CardScript> = {
  ...GOBLIN,
  ...POPO,
  ...FLEAUX,
  ...GRENOUILLES,
  ...POLICE,
  ...EMILE,
  ...PIRATE,
};
