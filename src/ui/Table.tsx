import { useEffect, useMemo, useRef, useState } from "react";
import { card } from "../data/cards";
import * as E from "../game/engine";
import { act, backToLobby, effect, update } from "../game/room";
import type { EffectAction, GameState, Room, Vote } from "../game/types";
import { isAutomated } from "../effects/runtime";
import ChoiceModal from "./ChoiceModal";
import FxLayer from "./FxLayer";
import { BLACK_HOLES, blackHoleLabel } from "../game/types";
import CardView from "./CardView";
import CardModal, { type Placing } from "./CardModal";
import PlayerModal from "./PlayerModal";

const PHASE_LABEL = { activation: "Activation des cartes", action: "Poser ou défausser", end: "Fin du tour" };

export default function Table({ room, uid }: { room: Room; uid: string }) {
  const g = room.game!;
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [openPlayer, setOpenPlayer] = useState<string | null>(null);
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [err, setErr] = useState("");
  const [showLog, setShowLog] = useState(true);
  const me = g.players[uid];
  const isPlayer = !!me;
  const current = E.currentPlayer(g);
  const myTurn = current === uid;
  const isHost = room.hostUid === uid;

  const auto = room.auto !== false;
  const run = (fn: (r: Room, g: GameState) => void) =>
    act(room.code, fn).catch((e) => setErr((e as Error).message));
  const runAuto = (a: EffectAction) => effect(room.code, a).catch((e) => setErr((e as Error).message));
  const nextCard = g.phase === "activation" ? E.nextActivation(g) : undefined;

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && setPlacing(null);
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);

  // Moi en bas, les autres dans l'ordre du tour à partir de moi.
  const others = useMemo(() => {
    const i = g.order.indexOf(uid);
    return i < 0 ? g.order : [...g.order.slice(i + 1), ...g.order.slice(0, i)];
  }, [g.order, uid]);

  const place = (target: string, index: number) => {
    if (!placing) return;
    const { id, from } = placing;
    setPlacing(null);
    if (auto && from === "hand" && myTurn && g.phase === "action") {
      runAuto({ t: "play", by: uid, card: id, target, index });
      return;
    }
    run((r, gg) => {
      if (from === "hand" && E.locate(gg, id)?.uid === uid) E.playFromHand(r, gg, uid, id, target, index);
      else E.moveCard(r, gg, id, { uid: target, zone: "terrain", index });
    });
  };

  const terrain = (owner: string, size: "s" | "m") => {
    const p = g.players[owner];
    const slots = [];
    for (let i = 0; i <= p.terrain.length; i++) {
      if (placing) slots.push(<button key={`s${i}`} className="slot" onClick={() => place(owner, i)}>+</button>);
      const id = p.terrain[i];
      if (id)
        slots.push(
          <CardView
            key={id}
            id={id}
            size={size}
            badge={String(i + 1)}
            highlight={owner === current && id === nextCard}
            auto={auto && isAutomated(id)}
            selected={placing?.id === id}
            onClick={() => setOpenCard(id)}
          />,
        );
    }
    return (
      <div className={`terrain ${placing ? "placing" : ""}`}>
        {slots}
        {!p.terrain.length && !placing && <span className="muted small empty">Terrain vide</span>}
      </div>
    );
  };

  const resources = (owner: string) => {
    const p = g.players[owner];
    const bh = BLACK_HOLES.find((b) => b.id === p.blackHole);
    return (
      <button className="resources" onClick={() => setOpenPlayer(owner)} title="Modifier les ressources">
        <span className="res gold" data-gold={owner}>💰 {p.gold}</span>
        <span className={`res ${p.sentience ? "on" : "off"}`} data-sent={owner}>🧠 {p.sentience ? "Vraie" : "Fausse"}</span>
        <span className="res bh" data-bh={owner}>{bh?.icon} {blackHoleLabel(p.blackHole)}</span>
      </button>
    );
  };

  const piles = (owner: string) => {
    const p = g.players[owner];
    return (
      <div className="piles">
        <span className="pile" title="Pioche">🂠 {p.deck.length}</span>
        <button className="pile" title="Défausse : cliquer pour voir" onClick={() => setOpenPlayer(owner)}>
          🗑 {p.discard.length}
        </button>
        {owner !== uid && <span className="pile" title="Cartes en main">✋ {p.hand.length}</span>}
      </div>
    );
  };

  const board = (owner: string) => {
    const lobbyP = room.players[owner];
    const ranked = g.ranking.findIndex((r) => r.team === E.teamKey(room, owner));
    return (
      <section key={owner} data-board={owner} className={`board ${owner === current ? "active" : ""} ${owner === uid ? "mine" : ""}`}>
        <header className="board-head">
          <strong className="pname">{owner === current && "▶ "}{lobbyP?.name}{owner === uid && " (toi)"}</strong>
          <span className="muted small">{lobbyP?.team ? `Équipe ${lobbyP.team}` : "Solo"} · {lobbyP?.deck}</span>
          {ranked >= 0 && <span className="badge gold-badge">🏆 {ranked + 1}</span>}
          {resources(owner)}
          {piles(owner)}
        </header>
        {terrain(owner, owner === uid ? "m" : "s")}
      </section>
    );
  };

  const teams = useMemo(() => [...new Set(g.order.map((u) => E.teamKey(room, u)))], [g.order, room]);

  return (
    <div className="table">
      <header className="topbar">
        <span className="code">{room.code}</span>
        <span>Tour {g.round}</span>
        <span className={`badge ${auto ? "auto-badge" : ""}`} title={auto ? "Les cartes ⚙ s'appliquent toutes seules" : "Tous les effets sont manuels"}>
          {auto ? "⚙ Auto" : "✋ Manuel"}
        </span>
        <span>
          Au tour de <strong>{room.players[current]?.name}</strong> — {PHASE_LABEL[g.phase]}
        </span>
        <Dice run={run} uid={uid} />
        <span className="grow" />
        {!isPlayer && <span className="badge">Spectateur</span>}
        <button className="ghost" onClick={() => setShowLog((v) => !v)}>{showLog ? "Masquer" : "Journal"}</button>
        <button className="ghost" onClick={() => (location.hash = "")}>Quitter</button>
      </header>

      <div className={`table-main ${showLog ? "with-log" : ""}`}>
        <div className="play-area">
          <section className="victory-bar">
            <div className="vc-common">
              <CardView id={g.commonVC} size="s" onClick={() => setOpenCard(g.commonVC)} />
              <div>
                <div className="small muted">Condition commune</div>
                <strong>{card(g.commonVC).name}</strong>
                <div className="team-checks">
                  {teams.map((t) => {
                    const done = g.commonDone.includes(t);
                    return (
                      <label key={t} className="check">
                        <input type="checkbox" checked={done} disabled={!isPlayer} onChange={(e) => run((r, gg) => E.setCommonDone(r, gg, t, e.target.checked))} />
                        {E.teamLabel(room, t)}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="vc-personal">
              {g.order.map((u) => {
                const p = g.players[u];
                if (!p.personalVC) return null;
                return (
                  <div key={u} className={`vc-item ${p.personalDone ? "vc-done" : ""}`}>
                    <CardView id={p.personalVC} size="s" done={p.personalDone} onClick={() => setOpenCard(p.personalVC!)} />
                    <div className="small">
                      <strong>{room.players[u]?.name}</strong>
                      <label className="check">
                        <input type="checkbox" checked={p.personalDone} disabled={!isPlayer} onChange={(e) => run((r, gg) => E.setPersonalDone(r, gg, u, e.target.checked))} />
                        remplie
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {g.pending && g.pending.prompt.chooser !== uid && (
            <div className="placing-banner waiting">
              ⏳ En attente de <b>{room.players[g.pending.prompt.chooser]?.name}</b> : {g.pending.prompt.text}
            </div>
          )}

          {placing && (
            <div className="placing-banner">
              Choisis un emplacement <b>+</b> sur un terrain pour « {card(placing.id).name} ».
              <button onClick={() => setPlacing(null)}>Annuler (Échap)</button>
            </div>
          )}

          <div className="others">{others.map(board)}</div>
          {isPlayer && board(uid)}

          {isPlayer && (
            <section className="hand-area">
              <TurnControls g={g} myTurn={myTurn} auto={auto} run={run} runAuto={runAuto} uid={uid} />
              <div className="hand">
                <span className="small muted">Ta main ({me.hand.length})</span>
                <div className="hand-cards">
                  {me.hand.map((id) => (
                    <CardView key={id} id={id} size="m" selected={placing?.id === id} onClick={() => setOpenCard(id)} />
                  ))}
                </div>
              </div>
            </section>
          )}
          {err && <p className="error" onClick={() => setErr("")}>{err}</p>}
        </div>
        {showLog && <Log g={g} />}
      </div>

      {openCard && (
        <CardModal
          id={openCard}
          room={room}
          uid={uid}
          run={run}
          onPlace={(p) => {
            setPlacing(p);
            setOpenCard(null);
          }}
          onClose={() => setOpenCard(null)}
        />
      )}
      {openPlayer && (
        <PlayerModal owner={openPlayer} room={room} uid={uid} run={run} onCard={setOpenCard} onClose={() => setOpenPlayer(null)} />
      )}
      {g.pending?.prompt.chooser === uid && (
        <ChoiceModal
          key={g.pending.answers.length}
          room={room}
          prompt={g.pending.prompt}
          onAnswer={(a) => effect(room.code, null, a).catch((e) => setErr((e as Error).message))}
          onCard={setOpenCard}
        />
      )}
      <FxLayer g={g} room={room} />
      {g.vote && <VoteModal room={room} uid={uid} isHost={isHost} />}
      {room.status === "ended" && <EndModal room={room} isHost={isHost} />}
    </div>
  );
}

function TurnControls({ g, myTurn, auto, run, runAuto, uid }: {
  g: GameState; myTurn: boolean; auto: boolean; uid: string;
  run: (fn: (r: Room, g: GameState) => void) => void; runAuto: (a: EffectAction) => void;
}) {
  if (!myTurn) return <div className="turn-controls muted">Ce n'est pas ton tour. Tu peux quand même utiliser les outils si un effet te concerne.</div>;
  const p = g.players[E.currentPlayer(g)];
  const cur = E.nextActivation(g);
  const done = (g.activated ?? []).length;
  const busy = !!g.pending;
  const manualCard = cur && !(auto && isAutomated(cur));
  return (
    <div className="turn-controls">
      <div className="steps">
        {(["activation", "action", "end"] as const).map((ph, i) => (
          <span key={ph} className={`step ${g.phase === ph ? "on" : ""}`}>{i + 1}. {PHASE_LABEL[ph]}</span>
        ))}
      </div>
      {g.phase === "activation" && !manualCard && (
        <div className="row wrap">
          <span>
            {done ? `${done} carte${done > 1 ? "s" : ""} activée${done > 1 ? "s" : ""}. ` : ""}Tes cartes vont s'activer dans l'ordre de lecture.
          </span>
          <button className="primary glow" disabled={busy} onClick={() => runAuto({ t: "activate", by: uid })}>✨ Activer mes cartes</button>
        </div>
      )}
      {g.phase === "activation" && manualCard && (
        <div className="row wrap">
          <span>
            Carte {done + 1}/{p.terrain.length} : <strong>{card(cur).name}</strong>
            {auto ? " (effet manuel : applique-le avec les outils)." : ". Applique son effet si possible."}
          </span>
          <button className="primary" onClick={() => run((r, gg) => E.activationStep(r, gg, true))}>Effet appliqué → suivante</button>
          <button onClick={() => run((r, gg) => E.activationStep(r, gg, false))}>Impossible → suivante</button>
          <button className="ghost" onClick={() => run((r, gg) => E.skipActivation(r, gg))}>Passer à la pose</button>
        </div>
      )}
      {g.phase === "action" && (
        <div className="row wrap">
          <span>Clique une carte de ta main pour la <b>poser</b> (puis active son effet) ou la <b>défausser</b>.</span>
          <button className="ghost" onClick={() => run((r, gg) => void (gg.phase = "end", E.log(gg, `${E.nameOf(r, E.currentPlayer(gg))} ne pose ni ne défausse.`)))}>Ne rien faire</button>
        </div>
      )}
      {g.phase === "end" && (
        <div className="row wrap">
          <span>Termine ton tour : tu piocheras jusqu'à {g.handSize} cartes.</span>
          <button className="primary" disabled={busy} onClick={() => (auto ? runAuto({ t: "endTurn", by: uid }) : run((r, gg) => E.endTurn(r, gg)))}>Fin du tour</button>
          <button className="ghost" onClick={() => run((r, gg) => E.grantExtraAction(r, gg))}>+1 pose (effet de carte)</button>
        </div>
      )}
    </div>
  );
}

function Dice({ run, uid }: { uid: string; run: (fn: (r: Room, g: GameState) => void) => void }) {
  const rollDie = (faces: number | "bh") =>
    run((r, g) => {
      const name = E.nameOf(r, uid);
      if (faces === "bh") E.log(g, `🎲 ${name} lance le dé trou noir : ${BLACK_HOLES[E.roll(4) - 1].id}.`);
      else E.log(g, `🎲 ${name} lance un d${faces} : ${E.roll(faces)}.`);
    });
  return (
    <span className="dice">
      🎲
      {[2, 4, 6, 20, 100].map((f) => (
        <button key={f} className="die" onClick={() => rollDie(f)}>d{f}</button>
      ))}
      <button className="die" onClick={() => rollDie("bh")}>🌀</button>
    </span>
  );
}

function Log({ g }: { g: GameState }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [g.log.length]);
  return (
    <aside className="log panel" ref={ref}>
      <h3>Journal</h3>
      {g.log.map((l, i) => (
        <p key={i} className={l.text.startsWith("—") ? "log-turn" : l.text.startsWith("🎲") ? "log-dice" : ""}>{l.text}</p>
      ))}
    </aside>
  );
}

function VoteModal({ room, uid, isHost }: { room: Room; uid: string; isHost: boolean }) {
  const g = room.game!;
  const last = g.ranking[g.ranking.length - 1];
  const votes = g.vote ?? {};
  const count = (v: Vote) => Object.values(votes).filter((x) => x === v).length;
  const vote = (v: Vote) => act(room.code, (_r, gg) => E.castVote(gg, uid, v));
  const apply = (v: Vote) =>
    v === "restart"
      ? backToLobby(room.code)
      : update(room.code, (r) => {
          if (!r.game) return;
          r.game.vote = null;
          if (v === "stop") r.status = "ended";
          else E.log(r.game, "La partie continue pour établir le classement.");
        });
  const opts: [Vote, string][] = [["continue", "Continuer (classement)"], ["stop", "Arrêter"], ["restart", "Nouvelle partie"]];
  return (
    <div className="modal-bg">
      <div className="modal panel">
        <h2>🏆 {last ? E.teamLabel(room, last.team) : ""} a gagné !</h2>
        <p>Que voulez-vous faire ?</p>
        <div className="vote-opts">
          {opts.map(([v, label]) => (
            <button key={v} className={votes[uid] === v ? "primary" : ""} onClick={() => vote(v)}>
              {label} ({count(v)})
            </button>
          ))}
        </div>
        {isHost ? (
          <div className="row wrap">
            <span className="small muted">Hôte : appliquer le choix →</span>
            {opts.map(([v, label]) => <button key={v} className="ghost" onClick={() => apply(v)}>{label}</button>)}
          </div>
        ) : (
          <p className="small muted">L'hôte appliquera le choix.</p>
        )}
      </div>
    </div>
  );
}

function EndModal({ room, isHost }: { room: Room; isHost: boolean }) {
  const g = room.game!;
  return (
    <div className="modal-bg">
      <div className="modal panel">
        <h2>Partie terminée</h2>
        <ol>
          {g.ranking.map((r) => <li key={r.team}>{E.teamLabel(room, r.team)} (tour {r.round})</li>)}
        </ol>
        {isHost ? <button className="primary" onClick={() => backToLobby(room.code)}>Nouvelle partie</button> : <p className="muted">L'hôte peut relancer une partie.</p>}
        <button className="ghost" onClick={() => (location.hash = "")}>Quitter</button>
      </div>
    </div>
  );
}
