import type { GameState } from "../game/types";

/**
 * État affiché par la table pendant les animations : tant qu'un effet n'est pas encore animé,
 * - un jet de dé (ou une roulette de joueurs) montre les cartes telles qu'elles étaient au moment du jet (le hasard d'abord, l'effet ensuite) ;
 * - une condition remplie (et la victoire qui en découle) reste cachée jusqu'à son animation ;
 * - le journal attend la fin des animations (il dévoilerait le dé ou le vainqueur).
 * `settledLog` : le journal tel qu'il était quand plus rien n'était en attente.
 */
export function viewState(g: GameState, doneId: number | null, settledLog: GameState["log"]): GameState {
  if (doneId == null) return g;
  const pending = (g.fx ?? []).filter((f) => f.id > doneId);
  if (!pending.length) return g;
  let v: GameState = { ...g, log: settledLog };
  // Dé ou roulette : la table reste comme au moment du tirage jusqu'à ce qu'il soit montré.
  const dice = pending.find((f) => (f.k === "dice" || f.k === "roulette") && f.snap);
  if ((dice?.k === "dice" || dice?.k === "roulette") && dice.snap) {
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

/**
 * Pendant un choix, la table montre l'action en cours (déjà jouée jusqu'au choix) plutôt que l'état d'avant :
 * joueurs, désactivations, journal et effets visuels de ce qui vient de se passer.
 */
export function withPreview(g: GameState): GameState {
  const pv = g.pending?.preview;
  if (!pv) return g;
  const known = new Set((g.fx ?? []).map((f) => f.id));
  return {
    ...g,
    players: pv.players,
    disabled: pv.disabled ?? g.disabled,
    fx: [...(g.fx ?? []), ...pv.fx.filter((f) => !known.has(f.id))],
    fxSeq: Math.max(g.fxSeq ?? 0, pv.fxSeq),
    log: [...g.log, ...pv.log],
  };
}
