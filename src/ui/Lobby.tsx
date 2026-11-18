import { useEffect, useState } from "react";
import { PLACEHOLDER, cardImage, deckBack } from "../data/cards";
import { kickPlayer, launch, update } from "../game/room";
import type { Room } from "../game/types";
import { LOBBY_DECKS } from "../effects/ready";
import { playDeckVoice } from "./voice";
import { DeckModal, VictoryModal } from "./Viewers";
import { deckColor, playerColor } from "./pose";

/** Ordre d'affichage des decks : les plus faciles d'abord, les decks en cours à la fin. */
const DIFF_RANK: Record<string, number> = { facile: 0, moyen: 1, difficile: 2 };
const SORTED_DECKS = [...LOBBY_DECKS].sort(
  (a, b) =>
    Number(!a.status.ready) - Number(!b.status.ready) ||
    (DIFF_RANK[a.deck.difficulty?.toLowerCase() ?? ""] ?? 3) - (DIFF_RANK[b.deck.difficulty?.toLowerCase() ?? ""] ?? 3),
);

export default function Lobby({ room, uid }: { room: Room; uid: string }) {
  const me = room.players[uid];
  const players = Object.values(room.players).sort((a, b) => a.joinedAt - b.joinedAt);
  const isHost = room.hostUid === uid;
  const [team, setTeam] = useState(me.team);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [viewDeck, setViewDeck] = useState<string | null>(null);
  const [showVC, setShowVC] = useState(false);
  useEffect(() => setTeam(me.team), [me.team]);

  const run = (p: Promise<unknown>) => p.catch((e) => setErr((e as Error).message));
  const pickDeck = (deck: string | null) =>
    run(update(room.code, (r) => {
      if (deck && !LOBBY_DECKS.find((d) => d.deck.name === deck)?.status.ready) throw new Error("Ce deck est encore en cours de création.");
      const taken = Object.values(r.players).some((p) => p.uid !== uid && p.deck === deck);
      if (deck && taken) throw new Error("Ce deck vient d'être pris.");
      r.players[uid].deck = deck;
      r.players[uid].ready = false; // changer de deck annule « prêt »
    }));
  const toggleReady = () => run(update(room.code, (r) => void (r.players[uid].ready = !r.players[uid].ready)));
  const saveTeam = () => run(update(room.code, (r) => void (r.players[uid].team = team.trim().slice(0, 20))));
  // L'hôte garde sa place (il est le seul à pouvoir lancer) : il ferme juste la page.
  const leave = () =>
    isHost ? (location.hash = "") : run(update(room.code, (r) => void delete r.players[uid]).then(() => (location.hash = "")));
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setErr("Copie impossible, partage le code à la main.");
    }
  };
  const withDeck = players.filter((p) => p.deck);
  const notReady = players.filter((p) => p.uid !== room.hostUid && !p.ready);

  return (
    <div className="lobby">
      <header className="lobby-head">
        <div>
          <h1>Salon <span className="code">{room.code}</span></h1>
          <p className="muted">Partage ce code ou le lien pour inviter des joueurs.</p>
        </div>
        <div className="row">
          <button onClick={copyLink}>{copied ? "Lien copié ✔" : "Copier le lien"}</button>
          <button className="ghost" onClick={leave}>Quitter</button>
        </div>
      </header>

      <div className="lobby-grid">
        <section className="panel">
          <h2>Joueurs ({players.length})</h2>
          <ul className="player-list">
            {players.map((p) => (
              <li key={p.uid} className={`lobby-player ${p.ready || p.uid === room.hostUid ? "is-ready" : ""}`} style={{ ["--pc" as string]: playerColor(room, p.uid) }}>
                <span className="lp-deck">
                  {p.deck ? <img src={deckBack(p.deck) ?? cardImage(LOBBY_DECKS.find((d) => d.deck.name === p.deck)?.deck.cards[0] ?? "")} alt="" onError={(e) => (e.currentTarget.src = PLACEHOLDER)} /> : <i>?</i>}
                </span>
                <span className="lp-body">
                  <span className="lp-top">
                    <strong className="lp-name">{p.name}</strong>
                    {p.uid === room.hostUid && <span className="badge">hôte</span>}
                    <span className="muted">{p.team ? `Équipe ${p.team}` : "Solo"}</span>
                  </span>
                  <span className={p.deck ? "deck-tag" : "muted"}>{p.deck ?? "spectateur (pas de deck)"}</span>
                </span>
                {p.uid !== room.hostUid && <span className={`lp-ready ${p.ready ? "on" : ""}`}>{p.ready ? "✔ Prêt" : "…"}</span>}
                {isHost && p.uid !== uid && (
                  <button
                    className="mini ghost danger lp-kick"
                    title={`Exclure ${p.name} du salon`}
                    onClick={() => confirm(`Exclure ${p.name} du salon ? Il ne pourra plus revenir.`) && run(kickPlayer(room.code, uid, p.uid))}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
          <label className="team-field">
            Ton équipe (même nom = même équipe, vide = solo)
            <div className="row">
              <input value={team} maxLength={20} onChange={(e) => setTeam(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveTeam()} placeholder="ex : Rouge" />
              <button onClick={saveTeam} disabled={team.trim() === me.team}>Valider</button>
            </div>
          </label>
          <label className="check auto-toggle">
            <input
              type="checkbox"
              checked={room.auto !== false}
              disabled={!isHost}
              onChange={(e) => run(update(room.code, (r) => void (r.auto = e.target.checked)))}
            />
            <span>
              <b>Mode automatique</b> — les effets des cartes et les conditions de victoire s'appliquent tout seuls. Décoché : les joueurs appliquent les effets à la main.
            </span>
          </label>
          {isHost ? (
            <>
              <button className="primary big" disabled={!withDeck.length || notReady.length > 0} onClick={() => run(launch(room.code))}>
                Lancer la partie ({withDeck.length} joueur{withDeck.length > 1 ? "s" : ""})
              </button>
              {notReady.length > 0 && <p className="muted small">En attente : {notReady.map((p) => p.name).join(", ")} (pas encore prêt).</p>}
            </>
          ) : (
            <>
              <button className={`big ready-btn ${me.ready ? "on" : ""}`} onClick={toggleReady}>
                {me.ready ? "✔ Prêt — cliquer pour annuler" : "Je suis prêt"}
              </button>
              <p className="muted">{me.ready ? "En attente de l'hôte pour lancer la partie…" : "Clique « Je suis prêt » quand tu as choisi ton deck."}</p>
            </>
          )}
          <p className="muted small">Les joueurs sans deck regardent la partie en spectateurs.</p>
          {err && <p className="error">{err}</p>}
        </section>

        <section className="panel">
          <div className="row deck-grid-head">
            <h2 className="grow">Choisis ton deck</h2>
            <button className="mini" onClick={() => setShowVC(true)}>🏁 Conditions de victoire</button>
          </div>
          <div className="deck-grid">
            {SORTED_DECKS.map(({ deck: d, status }) => {
              const holder = players.find((p) => p.deck === d.name);
              const mine = holder?.uid === uid;
              return (
                <div
                  key={d.name}
                  className={`deck-choice-wrap ${status.ready ? "" : "wip"}`}
                  style={{ ["--deck" as string]: deckColor(d.name), ...(holder ? { ["--pc" as string]: playerColor(room, holder.uid) } : {}) }}
                >
                <button
                  className={`deck-choice ${mine ? "selected" : ""} ${holder ? "taken" : ""}`}
                  disabled={!status.ready || (!!holder && !mine)}
                  title={status.ready ? d.summary : `En cours : ${status.why}`}
                  onClick={() => {
                    if (!mine) playDeckVoice(d.name);
                    pickDeck(mine ? null : d.name);
                  }}
                >
                  <span className="deck-stack">
                    <img src={deckBack(d.name) ?? cardImage(d.cards[0])} alt="" onError={(e) => (e.currentTarget.src = PLACEHOLDER)} />
                  </span>
                  {!status.ready && <span className="wip-ribbon">🚧 En cours</span>}
                  <span className="deck-name">{d.name}</span>
                  {d.difficulty && <span className={`deck-diff diff-${d.difficulty.toLowerCase()}`}>{d.difficulty}</span>}
                  {!!d.keywords?.length && <span className="deck-kw">{d.keywords.slice(0, 3).map((k) => <i key={k}>{k}</i>)}</span>}
                  <span className="small muted">
                    {!status.ready ? status.why : holder ? (mine ? "Ton deck ✔" : `pris par ${holder.name}`) : `${d.cards.length} cartes`}
                  </span>
                </button>
                <button className="mini deck-see" onClick={() => setViewDeck(d.name)}>👁 Voir le deck</button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
      {viewDeck && <DeckModal deck={viewDeck} onClose={() => setViewDeck(null)} />}
      {showVC && <VictoryModal decks={SORTED_DECKS.filter((d) => d.status.ready).map((d) => d.deck.name)} onClose={() => setShowVC(false)} />}
    </div>
  );
}
