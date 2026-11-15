import { useEffect, useState } from "react";
import { PLAYABLE_DECKS, cardImage } from "../data/cards";
import { launch, update } from "../game/room";
import type { Room } from "../game/types";

export default function Lobby({ room, uid }: { room: Room; uid: string }) {
  const me = room.players[uid];
  const players = Object.values(room.players).sort((a, b) => a.joinedAt - b.joinedAt);
  const isHost = room.hostUid === uid;
  const [team, setTeam] = useState(me.team);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setTeam(me.team), [me.team]);

  const run = (p: Promise<unknown>) => p.catch((e) => setErr((e as Error).message));
  const pickDeck = (deck: string | null) =>
    run(update(room.code, (r) => {
      const taken = Object.values(r.players).some((p) => p.uid !== uid && p.deck === deck);
      if (deck && taken) throw new Error("Ce deck vient d'être pris.");
      r.players[uid].deck = deck;
    }));
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
              <li key={p.uid}>
                <strong>{p.name}</strong>
                {p.uid === room.hostUid && <span className="badge">hôte</span>}
                <span className="muted">{p.team ? `Équipe ${p.team}` : "Solo"}</span>
                <span className={p.deck ? "deck-tag" : "muted"}>{p.deck ?? "spectateur (pas de deck)"}</span>
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
          {isHost ? (
            <button className="primary big" disabled={!withDeck.length} onClick={() => run(launch(room.code))}>
              Lancer la partie ({withDeck.length} joueur{withDeck.length > 1 ? "s" : ""})
            </button>
          ) : (
            <p className="muted">En attente de l'hôte pour lancer la partie…</p>
          )}
          <p className="muted small">Les joueurs sans deck regardent la partie en spectateurs.</p>
          {err && <p className="error">{err}</p>}
        </section>

        <section className="panel">
          <h2>Choisis ton deck</h2>
          <div className="deck-grid">
            {PLAYABLE_DECKS.map((d) => {
              const holder = players.find((p) => p.deck === d.name);
              const mine = holder?.uid === uid;
              return (
                <button
                  key={d.name}
                  className={`deck-choice ${mine ? "selected" : ""}`}
                  disabled={!!holder && !mine}
                  onClick={() => pickDeck(mine ? null : d.name)}
                >
                  <img src={cardImage(d.cards[0])} alt="" onError={(e) => (e.currentTarget.src = "/cards/placeholder.svg")} />
                  <span className="deck-name">{d.name}</span>
                  <span className="small muted">{holder ? (mine ? "Ton deck ✔" : `pris par ${holder.name}`) : `${d.cards.length} cartes`}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
