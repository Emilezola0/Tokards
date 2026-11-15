import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { card } from "../data/cards";
import * as E from "../game/engine";
import { act, backToLobby, effect, update } from "../game/room";
import type { EffectAction, GameState, Room, Vote } from "../game/types";
import { BLACK_HOLES, setShowWeather } from "../game/types";
import { isAutomated, previewEffect } from "../effects/runtime";
import ChoiceModal from "./ChoiceModal";
import FxLayer from "./FxLayer";
import CardView from "./CardView";
import CardModal, { type Placing } from "./CardModal";
import PlayerModal from "./PlayerModal";
import PlayerBoard, { BH, BW, type DragSrc, type Seat } from "./PlayerBoard";
import HoverCard from "./HoverCard";
import { VersionTag } from "./UpdatePrompt";
import { PLAYER_COLORS } from "./pose";
import { fxStore, useFx } from "./fxStore";
import { dealDuration, useCardFlip } from "./useCardFlip";

const PHASE_LABEL = { activation: "Activation", action: "Poser / défausser", end: "Fin du tour" };

/** Place les plateaux autour de la table : le mien en bas, les autres dans l'ordre du tour, face au centre. */
function seats(n: number, W: number, H: number): Seat[] {
  const HUB_W = 160;
  const HUB_H = 175;
  let last: Seat[] = [];
  for (let s = 1.1; s >= 0.2; s -= 0.02) {
    const out: Seat[] = [];
    const boxes: number[][] = [];
    let ok = true;
    for (let i = 0; i < n; i++) {
      const a = 90 + (i * 360) / n;
      const rot = (((Math.round((a - 90) / 90) * 90) % 360) + 360) % 360;
      const rad = (a * Math.PI) / 180;
      const vertical = rot % 180 !== 0;
      const hx = ((vertical ? BH : BW) * s) / 2;
      const hy = ((vertical ? BW : BH) * s) / 2;
      const ux = Math.cos(rad);
      const uy = Math.sin(rad);
      const t = Math.min(
        Math.abs(ux) > 1e-6 ? (W / 2 - hx - 6) / Math.abs(ux) : Infinity,
        Math.abs(uy) > 1e-6 ? (H / 2 - hy - 6) / Math.abs(uy) : Infinity,
      );
      if (t < 0 || hx * 2 > W || hy * 2 > H) {
        ok = false;
        break;
      }
      const x = W / 2 + ux * (n === 1 ? t : t);
      const y = H / 2 + uy * t;
      out.push({ x, y, rot, s });
      boxes.push([x - hx, y - hy, x + hx, y + hy]);
    }
    if (!ok) continue;
    last = out;
    boxes.push([W / 2 - HUB_W / 2, H / 2 - HUB_H / 2, W / 2 + HUB_W / 2, H / 2 + HUB_H / 2]);
    const overlap = boxes.some((a, i) => boxes.some((b, j) => j > i && a[0] < b[2] - 2 && b[0] < a[2] - 2 && a[1] < b[3] - 2 && b[1] < a[3] - 2));
    if (!overlap) return out;
  }
  return last;
}

function useSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: innerWidth, h: innerHeight - 60 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export default function Table({ room, uid }: { room: Room; uid: string }) {
  const g = room.game!;
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [openPlayer, setOpenPlayer] = useState<string | null>(null);
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [drag, setDrag] = useState<DragSrc | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [err, setErr] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [fresh] = useState(() => !!g.startedAt && Date.now() - g.startedAt < 15000 && g.round === 1 && g.turn === 0);
  const arena = useRef<HTMLDivElement>(null);
  const size = useSize(arena);
  const fx = useFx();

  const me = g.players[uid];
  const isPlayer = !!me;
  const current = E.currentPlayer(g);
  const myTurn = current === uid;
  const isHost = room.hostUid === uid;
  const auto = room.auto !== false;
  const canPlay = isPlayer && myTurn && g.phase === "action" && !g.pending;
  const moving: DragSrc | null = drag ?? placing;

  // Infos contextuelles : la météo n'est évoquée que si le deck Météo est en jeu.
  const decksInPlay = g.order.map((u) => room.players[u]?.deck);
  setShowWeather(decksInPlay.includes("Météo"));

  const run = (fn: (r: Room, g: GameState) => void) => act(room.code, fn).catch((e) => setErr((e as Error).message));
  const runAuto = (a: EffectAction) => effect(room.code, a).catch((e) => setErr((e as Error).message));

  const colorOf = (u: string) => PLAYER_COLORS[Math.max(0, g.order.indexOf(u)) % PLAYER_COLORS.length];
  const myTeam = room.players[uid]?.team.trim();

  useCardFlip(arena, g, fresh);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPlacing(null);
        setDrag(null);
      }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);

  // ----- Déroulé automatique du tour (exécuté par le client du joueur actif) -----
  const autoKey = useRef("");
  const autoEnd = auto && (g.lastPlayed == null || isAutomated(g.lastPlayed));
  useEffect(() => {
    if (!isPlayer || !myTurn || g.pending || fxStore.isBusy() || room.status !== "playing" || g.vote) return;
    const key = `${g.round}-${g.turn}-${g.phase}-${g.activated?.length ?? 0}-${me.hand.length}-${g.actionsLeft}`;
    if (autoKey.current === key) return;
    if (auto && g.phase === "activation") {
      const id = E.nextActivation(g);
      if (id && isAutomated(id)) {
        autoKey.current = key;
        runAuto({ t: "activate", by: uid });
      }
    } else if (g.phase === "action" && !me.hand.length) {
      autoKey.current = key;
      run((r, gg) => E.passEmptyHand(r, gg));
    } else if (g.phase === "end" && autoEnd) {
      autoKey.current = key;
      runAuto({ t: "endTurn", by: uid });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, fx.busy]);

  // ----- Glisser-déposer -----
  const dropTerrain = (owner: string, index: number) => {
    const src = moving;
    setDrag(null);
    setPlacing(null);
    if (!src || !isPlayer || !myTurn || g.pending) return;
    if (src.from === "hand") {
      if (!canPlay || owner !== uid) return;
      if (auto) runAuto({ t: "play", by: uid, card: src.id, target: owner, index });
      else run((r, gg) => E.playFromHand(r, gg, uid, src.id, owner, index));
    } else {
      run((r, gg) => E.moveCard(r, gg, src.id, { uid: owner, zone: "terrain", index }));
    }
  };
  const dropDiscard = (owner: string) => {
    const src = moving;
    setDrag(null);
    setPlacing(null);
    if (!src || src.from !== "hand" || owner !== uid || !canPlay) return;
    run((r, gg) => E.discardFromHand(r, gg, uid, src.id));
  };

  // ----- Survol -----
  const hoverTimer = useRef<number>(0);
  const onHover = (id: string | null, e?: MouseEvent) => {
    clearTimeout(hoverTimer.current);
    if (!id || drag) return setHover(null);
    const x = e?.clientX ?? 0;
    const y = e?.clientY ?? 0;
    hoverTimer.current = window.setTimeout(() => setHover({ id, x, y }), 220);
  };
  const preview = useMemo(() => {
    if (!hover || !auto) return null;
    const at = E.locate(g, hover.id);
    if (!at || (at.zone !== "terrain" && at.zone !== "hand")) return null;
    return previewEffect(room, hover.id, at.zone === "hand" ? at.uid : at.uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover?.id, g]);

  const viewer = Math.max(0, g.order.indexOf(uid));
  const seated = [...g.order.slice(viewer), ...g.order.slice(0, viewer)];
  const layout = useMemo(() => seats(seated.length, size.w, size.h), [seated.length, size.w, size.h]);
  const teams = useMemo(() => [...new Set(g.order.map((u) => E.teamKey(room, u)))], [g.order, room]);

  return (
    <div className="table">
      <header className="topbar">
        <span className="code">{room.code}</span>
        <span className="muted">Tour {g.round}</span>
        <span className={`badge ${auto ? "auto-badge" : ""}`} title={auto ? "Les cartes ⚙ s'appliquent toutes seules" : "Tous les effets sont manuels"}>
          {auto ? "⚙ Auto" : "✋ Manuel"}
        </span>
        <span className="turn-chip" style={{ ["--pc" as string]: colorOf(current) }}>
          ▶ {room.players[current]?.name}
        </span>
        <span className="steps">
          {(["activation", "action", "end"] as const).map((ph, i) => (
            <span key={ph} className={`step ${g.phase === ph ? "on" : ""}`}>{i + 1}. {PHASE_LABEL[ph]}</span>
          ))}
        </span>
        <TurnControls g={g} room={room} uid={uid} myTurn={myTurn && isPlayer} auto={auto} autoEnd={autoEnd} busy={fx.busy} run={run} runAuto={runAuto} />
        <span className="grow" />
        {!isPlayer && <span className="badge">Spectateur</span>}
        <Dice run={run} uid={uid} enabled={isPlayer && myTurn} />
        <button className="ghost" onClick={() => setShowLog((v) => !v)}>📜 Journal</button>
        <button className="ghost" onClick={() => (location.hash = "")}>Quitter</button>
      </header>

      <div className={`arena ${moving ? "is-moving" : ""}`} ref={arena}>
        <div className="table-felt" />
        {seated.map((owner, i) =>
          layout[i] ? (
            <PlayerBoard
              key={owner}
              room={room}
              g={g}
              owner={owner}
              uid={uid}
              seat={layout[i]}
              color={colorOf(owner)}
              ally={!!myTeam && owner !== uid && room.players[owner]?.team.trim() === myTeam}
              auto={auto}
              faceUpHand={owner === uid}
              moving={moving}
              canDropHere={!!moving && isPlayer && myTurn && (moving.from !== "hand" || owner === uid)}
              canDragHand={canPlay}
              canDragTerrain={isPlayer && myTurn && !auto && !g.pending}
              preview={preview}
              onCard={setOpenCard}
              onPlayer={setOpenPlayer}
              onHover={onHover}
              onDropTerrain={dropTerrain}
              onDropDiscard={dropDiscard}
              onDragStart={(s) => {
                setHover(null);
                setDrag(s);
              }}
              onDragEnd={() => setTimeout(() => setDrag(null), 0)}
            />
          ) : null,
        )}

        <div className="hub">
          <span className="small muted">Condition commune</span>
          <div data-vc="common">
            <CardView id={g.commonVC} size="s" onClick={() => setOpenCard(g.commonVC)} onHover={onHover} />
          </div>
          <div className="hub-teams">
            {teams.map((t) => (
              <span key={t} className={`team-dot ${g.commonDone.includes(t) ? "done" : ""}`} title={`${E.teamLabel(room, t)} : ${g.commonDone.includes(t) ? "remplie" : "pas encore"}`}>
                {g.commonDone.includes(t) ? "✔ " : ""}{E.teamLabel(room, t)}
              </span>
            ))}
          </div>
        </div>

        {g.pending && g.pending.prompt.chooser !== uid && (
          <div className="floating-banner waiting">
            ⏳ En attente de <b>{room.players[g.pending.prompt.chooser]?.name}</b> : {g.pending.prompt.text}
          </div>
        )}
        {placing && (
          <div className="floating-banner">
            Choisis un emplacement sur {placing.from === "hand" ? "ton terrain" : "un terrain"} pour « {card(placing.id).name} ».
            <button onClick={() => setPlacing(null)}>Annuler (Échap)</button>
          </div>
        )}
      </div>

      {err && <p className="toast error" onClick={() => setErr("")}>{err}</p>}
      {showLog && <Log g={g} onClose={() => setShowLog(false)} />}

      {hover && !openCard && !drag && <HoverCard id={hover.id} x={hover.x} y={hover.y} preview={preview} auto={auto} />}

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
      {g.pending?.prompt.chooser === uid && !fx.busy && (
        <ChoiceModal
          key={g.pending.answers.length}
          room={room}
          prompt={g.pending.prompt}
          onAnswer={(a) => effect(room.code, null, a).catch((e) => setErr((e as Error).message))}
          onCard={setOpenCard}
        />
      )}
      <FxLayer g={g} room={room} me={uid} fresh={fresh} startDelay={fresh ? dealDuration(g) : 0} colorOf={colorOf} />
      {g.vote && <VoteModal room={room} uid={uid} isHost={isHost} />}
      {room.status === "ended" && <EndModal room={room} isHost={isHost} />}
    </div>
  );
}

function TurnControls({ g, room, uid, myTurn, auto, autoEnd, busy, run, runAuto }: {
  g: GameState; room: Room; uid: string; myTurn: boolean; auto: boolean; autoEnd: boolean; busy: boolean;
  run: (fn: (r: Room, g: GameState) => void) => void; runAuto: (a: EffectAction) => void;
}) {
  if (!myTurn) return null;
  const cur = E.nextActivation(g);
  const pending = !!g.pending;
  const manualCard = g.phase === "activation" && cur && !(auto && isAutomated(cur));
  if (manualCard)
    return (
      <span className="controls">
        <span>Effet manuel : <strong>{card(cur).name}</strong></span>
        <button className="primary" onClick={() => run((r, gg) => E.activationStep(r, gg, true))}>Appliqué ✔</button>
        <button onClick={() => run((r, gg) => E.activationStep(r, gg, false))}>Impossible ✖</button>
      </span>
    );
  if (g.phase === "activation") return <span className="controls muted">{busy || pending ? "…" : "Activation de tes cartes…"}</span>;
  if (g.phase === "action")
    return (
      <span className="controls hint-text">
        {g.players[uid].hand.length ? "Glisse une carte de ta main sur ton terrain (pose) ou sur ta défausse" : "Main vide"}
      </span>
    );
  return (
    <span className="controls">
      {autoEnd ? (
        <span className="muted">Fin du tour…</span>
      ) : (
        <>
          <button className="primary" disabled={pending} onClick={() => (auto ? runAuto({ t: "endTurn", by: uid }) : run((r, gg) => E.endTurn(r, gg)))}>
            Fin du tour (pioche jusqu'à {g.handSize})
          </button>
          <button className="ghost" onClick={() => run((r, gg) => E.grantExtraAction(r, gg))} title="Si une carte manuelle donne une pose en plus">+1 pose</button>
        </>
      )}
      <span className="small muted">{E.nameOf(room, uid)}</span>
    </span>
  );
}

function Dice({ run, uid, enabled }: { uid: string; enabled: boolean; run: (fn: (r: Room, g: GameState) => void) => void }) {
  const rollDie = (faces: number | "bh") =>
    run((r, g) => {
      const name = E.nameOf(r, uid);
      if (faces === "bh") {
        const v = E.roll(4);
        E.pushFx(g, { k: "dice", uid, faces: 4, value: v });
        E.log(g, `🎲 ${name} lance le dé trou noir : ${BLACK_HOLES[v - 1].id}.`);
      } else {
        const v = E.roll(faces);
        E.pushFx(g, { k: "dice", uid, faces, value: v });
        E.log(g, `🎲 ${name} lance un d${faces} : ${v}.`);
      }
    });
  if (!enabled) return null;
  return (
    <span className="dice" title="Dés (effets manuels)">
      🎲
      {[2, 4, 6, 20, 100].map((f) => (
        <button key={f} className="die" onClick={() => rollDie(f)}>d{f}</button>
      ))}
      <button className="die" onClick={() => rollDie("bh")}>🌀</button>
    </span>
  );
}

function Log({ g, onClose }: { g: GameState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [g.log.length]);
  return (
    <aside className="log-drawer panel">
      <div className="row">
        <h3 className="grow">Journal</h3>
        <VersionTag />
        <button className="ghost" onClick={onClose}>✕</button>
      </div>
      <div className="log-body" ref={ref}>
        {g.log.map((l, i) => (
          <p key={i} className={l.text.startsWith("—") ? "log-turn" : l.text.startsWith("🎲") ? "log-dice" : ""}>{l.text}</p>
        ))}
      </div>
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
