import { useEffect, useRef, useState } from "react";
import { PLACEHOLDER, cardImage, deckBack } from "../data/cards";
import { kickPlayer, launch, leaveRoom, transferHost, update } from "../game/room";
import type { Room } from "../game/types";
import { lobbyDecks } from "../effects/ready";
import { playDeckVoice } from "./voice";
import { DeckModal, VictoryModal } from "./Viewers";
import { deckColor, playerColor } from "./pose";
import { sfx } from "./sfx";

/** Équipes proposées en un clic (un nom libre reste possible). */
const TEAMS: { name: string; color: string }[] = [
  { name: "Rouge", color: "#ff5c6c" },
  { name: "Bleu", color: "#4f8cff" },
  { name: "Vert", color: "#3ddc84" },
  { name: "Jaune", color: "#ffcf3a" },
];

/** Ordre d'affichage des decks : les plus faciles d'abord, les decks en cours à la fin. */
const DIFF_RANK: Record<string, number> = { facile: 0, moyen: 1, difficile: 2 };
const sortedDecks = () => lobbyDecks().sort(
  (a, b) =>
    Number(!a.status.ready) - Number(!b.status.ready) ||
    (DIFF_RANK[a.deck.difficulty?.toLowerCase() ?? ""] ?? 3) - (DIFF_RANK[b.deck.difficulty?.toLowerCase() ?? ""] ?? 3),
);

export default function Lobby({ room, uid }: { room: Room; uid: string }) {
  const me = room.players[uid];
  const SORTED_DECKS = sortedDecks();
  const players = Object.values(room.players).sort((a, b) => a.joinedAt - b.joinedAt);
  const isHost = room.hostUid === uid;
  const [team, setTeam] = useState(me.team);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [viewDeck, setViewDeck] = useState<string | null>(null);
  const [showVC, setShowVC] = useState(false);
  useEffect(() => setTeam(me.team), [me.team]);
  // Un joueur passe « prêt » : une voiceline au hasard de son deck, chez tout le monde.
  const wasReady = useRef<Set<string> | null>(null);
  useEffect(() => {
    const now = new Set(players.filter((p) => p.ready && p.deck).map((p) => p.uid));
    if (wasReady.current) for (const p of players) if (now.has(p.uid) && !wasReady.current.has(p.uid)) playDeckVoice(p.deck!);
    wasReady.current = now;
  });

  // Quelqu'un arrive ou part : petit son et annonce.
  const [notes, setNotes] = useState<{ id: number; text: string }[]>([]);
  const known = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const now = new Map(players.map((p) => [p.uid, p.name]));
    const prev = known.current;
    known.current = now;
    if (!prev) return;
    const add: string[] = [];
    for (const [u, n] of now) if (!prev.has(u) && u !== uid) add.push(`👋 ${n} a rejoint le salon`);
    for (const [u, n] of prev) if (!now.has(u)) add.push(`🚪 ${n} est parti`);
    if (prev.size && room.hostUid !== hostRef.current && room.players[room.hostUid]) add.push(`👑 ${room.players[room.hostUid].name} est maintenant l'hôte`);
    hostRef.current = room.hostUid;
    if (!add.length) return;
    sfx.turn();
    const items = add.map((text) => ({ id: Math.random(), text }));
    setNotes((l) => [...l, ...items].slice(-4));
    setTimeout(() => setNotes((l) => l.filter((x) => !items.includes(x))), 3500);
  });
  const hostRef = useRef(room.hostUid);

  const run = (p: Promise<unknown>) => p.catch((e) => setErr((e as Error).message));
  const pickDeck = (deck: string | null) =>
    run(update(room.code, (r) => {
      if (deck && !SORTED_DECKS.find((d) => d.deck.name === deck)?.status.ready) throw new Error("Ce deck est encore en cours de création.");
      const taken = Object.values(r.players).some((p) => p.uid !== uid && p.deck === deck);
      if (deck && taken) throw new Error("Ce deck vient d'être pris.");
      r.players[uid].deck = deck;
      r.players[uid].ready = false; // changer de deck annule « prêt »
    }));
  const randomDeck = () => {
    const free = SORTED_DECKS.filter(({ deck: d, status }) => status.ready && d.name !== me.deck && !players.some((p) => p.uid !== uid && p.deck === d.name));
    if (!free.length) return setErr("Aucun autre deck libre.");
    const d = free[Math.floor(Math.random() * free.length)].deck.name;
    playDeckVoice(d);
    pickDeck(d);
  };
  const setMyTeam = (t: string) => {
    setTeam(t);
    run(update(room.code, (r) => void (r.players[uid].team = t)));
  };
  // L'hôte répartit les joueurs (avec un deck) en 2 équipes au hasard, aussi égales que possible.
  const randomTeams = () =>
    run(update(room.code, (r) => {
      const list = Object.values(r.players).filter((p) => p.deck).sort(() => Math.random() - 0.5);
      list.forEach((p, i) => (p.team = TEAMS[i % 2].name));
    }));
  const toggleReady = () => run(update(room.code, (r) => void (r.players[uid].ready = !r.players[uid].ready)));
  const saveTeam = () => run(update(room.code, (r) => void (r.players[uid].team = team.trim().slice(0, 20))));
  // Quitter : la place est libérée ; si c'était l'hôte, le rôle passe au joueur arrivé le plus tôt.
  const leave = () => {
    const next = players.find((p) => p.uid !== uid);
    if (isHost && next && !confirm(`Quitter le salon ? ${next.name} deviendra l'hôte.`)) return;
    run(leaveRoom(room.code, uid).then(() => (location.hash = "")));
  };
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
  // Seuls les joueurs avec un deck doivent être prêts : les autres regardent.
  const notReady = players.filter((p) => p.uid !== room.hostUid && p.deck && !p.ready);

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
                  {p.deck ? <img src={deckBack(p.deck) ?? cardImage(SORTED_DECKS.find((d) => d.deck.name === p.deck)?.deck.cards[0] ?? "")} alt="" onError={(e) => (e.currentTarget.src = PLACEHOLDER)} /> : <i>?</i>}
                </span>
                <span className="lp-body">
                  <span className="lp-top">
                    <strong className="lp-name">{p.name}</strong>
                    {p.uid === room.hostUid && <span className="badge">hôte</span>}
                    <span className="muted" style={{ color: TEAMS.find((t) => t.name === p.team)?.color }}>{p.team ? `Équipe ${p.team}` : "Solo"}</span>
                  </span>
                  <span className={p.deck ? "deck-tag" : "muted"}>{p.deck ?? "spectateur (pas de deck)"}</span>
                </span>
                {p.uid !== room.hostUid && <span className={`lp-ready ${p.ready ? "on" : ""}`}>{p.ready ? "✔ Prêt" : "…"}</span>}
                {isHost && p.uid !== uid && (
                  <button
                    className="mini ghost lp-kick"
                    title={`Donner le rôle d'hôte à ${p.name}`}
                    onClick={() => confirm(`Donner le rôle d'hôte à ${p.name} ? Il pourra lancer la partie et exclure des joueurs.`) && run(transferHost(room.code, uid, p.uid))}
                  >
                    👑
                  </button>
                )}
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
          <div className="team-field">
            <span>Ton équipe</span>
            <div className="team-pills">
              <button className={`team-pill ${!me.team ? "on" : ""}`} onClick={() => setMyTeam("")}>Solo</button>
              {TEAMS.map((t) => (
                <button key={t.name} className={`team-pill ${me.team === t.name ? "on" : ""}`} style={{ ["--tc" as string]: t.color }} onClick={() => setMyTeam(t.name)}>
                  {t.name}
                </button>
              ))}
              {isHost && <button className="team-pill ghost" title="Répartir les joueurs avec un deck en 2 équipes au hasard" onClick={randomTeams}>🎲 Au hasard</button>}
            </div>
            <span className="muted small">Ou un nom libre (même nom = même équipe) :</span>
            <div className="row">
              <input value={team} maxLength={20} onChange={(e) => setTeam(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveTeam()} placeholder="ex : Rouge" />
              <button onClick={saveTeam} disabled={team.trim() === me.team}>Valider</button>
            </div>
          </div>
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
                {withDeck.length ? `Lancer la partie (${withDeck.length} joueur${withDeck.length > 1 ? "s" : ""})` : "Choisis un deck pour lancer"}
              </button>
              {notReady.length > 0 && <p className="muted small">En attente : {notReady.map((p) => p.name).join(", ")} (pas encore prêt).</p>}
              {notReady.length > 0 && withDeck.some((p) => p.uid === room.hostUid || p.ready) && (
                <button
                  className="ghost small"
                  onClick={() => confirm(`Lancer sans attendre ? ${notReady.map((p) => p.name).join(", ")} regardera la partie en spectateur.`) && run(launch(room.code, true))}
                >
                  Lancer quand même (les autres regardent)
                </button>
              )}
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
            <button className="mini" onClick={randomDeck} title="Prendre un deck libre au hasard">🎲 Deck au hasard</button>
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
      <div className="lobby-notes" aria-live="polite">
        {notes.map((n) => <div key={n.id} className="lobby-note">{n.text}</div>)}
      </div>
      {viewDeck && <DeckModal deck={viewDeck} onClose={() => setViewDeck(null)} />}
      {showVC && <VictoryModal decks={SORTED_DECKS.filter((d) => d.status.ready).map((d) => d.deck.name)} onClose={() => setShowVC(false)} />}
    </div>
  );
}
