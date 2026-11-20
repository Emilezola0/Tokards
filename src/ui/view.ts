import type { GameState } from "../game/types";

/**
 * État affiché par la table pendant les animations : tant qu'un effet n'est pas encore animé,
 * - un jet de dé montre les cartes telles qu'elles étaient au moment du jet (le hasard d'abord, l'effet ensuite) ;
 * - une condition remplie (et la victoire qui en découle) reste cachée jusqu'à son animation ;
 * - le journal attend la fin des animations (il dévoilerait le dé ou le vainqueur).
 * `settledLog` : le journal tel qu'il était quand plus rien n'était en attente.
 */
export function viewState(g: GameState, doneId: number | null, settledLog: GameState["log"]): GameState {
  if (doneId == null) return g;
  const pending = (g.fx ?? []).filter((f) => f.id > doneId);
  if (!pending.length) return g;
  let v: GameState = { ...g, log: settledLog };
  const dice = pending.find((f) => f.k === "dice" && f.snap);
  if (dice?.k === "dice" && dice.snap) {
    const players = { ...v.players };
    for (const [u, z] of Object.entries(dice.snap.z)) if (players[u]) players[u] = { ...players[u], ...z };
    v = { ...v, players, disabled: dice.snap.disabled };
  }
  const wins = pending.filter((f) => f.k === "vcDone");
  if (wins.length) {
    const players = { ...v.players };
    const teams = new Set<string>();
    let common = v.commonDone;
    for (const w of wins) {
      if (w.k !== "vcDone") continue;
      teams.add(w.team);
      if (w.card === g.commonVC) common = common.filter((t) => t !== w.team);
      else if (players[w.uid]) players[w.uid] = { ...players[w.uid], personalDone: false };
    }
    const ranking = v.ranking.filter((r) => !teams.has(r.team));
    v = { ...v, players, commonDone: common, ranking, vote: ranking.length === v.ranking.length ? v.vote : null };
  }
  return v;
}
