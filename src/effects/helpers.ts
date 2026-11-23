// Petites aides partagées par les scripts des decks : cartes « armées », marques et gold stockés sur une carte.
import type { Ctx } from "./runtime";

/** La carte a-t-elle un effet en attente (prochain tour, prochain vol…) ? */
export const isArmed = (x: Ctx, id: string) => (x.g.armed ?? []).includes(id);
export const arm = (x: Ctx, id: string) => {
  if (!isArmed(x, id)) x.g.armed = [...(x.g.armed ?? []), id];
};
export const disarm = (x: Ctx, id: string) => {
  x.g.armed = (x.g.armed ?? []).filter((c) => c !== id);
};

/** Marque d'une carte (cible suivie, compteur…). */
export const mark = (x: Ctx, key: string) => x.g.marks?.[key];
/** Pose ou retire (null) la marque `key`. Les nombres sont enregistrés en texte. */
export function setMark(x: Ctx, key: string, v: string | number | null | undefined) {
  const m = { ...(x.g.marks ?? {}) };
  if (v == null) delete m[key];
  else m[key] = String(v);
  x.g.marks = m;
}

/** Gold stockés sur une carte. */
export const store = (x: Ctx, id: string) => x.g.cardStore?.[id] ?? 0;

/** Joueurs encore en jeu, dans l'ordre du tour en partant du joueur actif. */
export const alive = (x: Ctx) => x.turnOrder().filter((u) => !x.p(u).out);
