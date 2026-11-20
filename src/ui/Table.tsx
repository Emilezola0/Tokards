import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { DECKS, PLACEHOLDER, card, cardImage, deckBack } from "../data/cards";
import * as E from "../game/engine";
import { act, backToLobby, effect, update } from "../game/room";
import type { EffectAction, GameState, Room, Vote } from "../game/types";
import { BLACK_HOLES, setShowWeather } from "../game/types";
import { isAutomated, noPlayReason, previewEffect } from "../effects/runtime";
import ChoiceModal, { ChoiceDock, onTable, useTablePick } from "./ChoiceModal";
import FxLayer from "./FxLayer";
import CardView from "./CardView";
import CardModal, { type Placing } from "./CardModal";
import PlayerModal from "./PlayerModal";
import PlayerBoard, { BH, BW, Gauge, type DragSrc, type Seat } from "./PlayerBoard";
import { DeckModal, GoneModal, TerrainModal } from "./Viewers";
import { sfx } from "./sfx";
import SoundControl from "./SoundControl";
import { claimWord, vcProgress, voteWord } from "../game/victory";
import HoverCard from "./HoverCard";
import KwText from "./KwText";
import { VersionTag } from "./UpdatePrompt";
import { playerColor } from "./pose";
import { fxStore, useFx } from "./fxStore";
import { dealDuration, useCardFlip } from "./useCardFlip";

const PHASE_LABEL = { activation: "Activation", action: "Poser / défausser", end: "Fin du tour" };

/** Taille d'une jauge de condition commune posée devant un terrain. */
const GW = 132;
const GH = 38;
/** Angle (degrés, écran) de la place `i` : le mien en bas, puis le joueur suivant à droite (sens antihoraire). */
const seatAngle = (i: number, n: number) => 90 - (i * 360) / n;

/** Place les plateaux en cercle autour de la table (le mien en bas, le suivant à droite, le précédent à gauche),
 * tous à l'endroit pour rester lisibles. Chaque plateau a sa jauge de condition commune côté centre, sans chevauchement. */
function seats(n: number, W: number, H: number): Seat[] {
  // Place réservée au centre pour la condition commune.
  const HUB_W = 150;
  const HUB_H = 150;
  let last: Seat[] = [];
  for (let s = 1.1; s >= 0.2; s -= 0.02) {
    const out: Seat[] = [];
    const boxes: number[][] = [];
    let ok = true;
    for (let i = 0; i < n; i++) {
      const a = seatAngle(i, n);
      const rot = 0;
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
      // Jauge : sur le trajet vers le centre, juste après le bord du plateau.
      let dx = W / 2 - x;
      let dy = H / 2 - y;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl;
      dy /= dl;
      // Plus petite distance (le long de ce trajet) qui sépare la jauge du plateau, + une petite marge.
      const sep = Math.min(Math.abs(dx) > 1e-6 ? (hx + GW / 2) / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? (hy + GH / 2) / Math.abs(dy) : Infinity) + 6;
      const gx = x + dx * sep;
      const gy = y + dy * sep;
      out.push({ x, y, rot, s, gx, gy });
      boxes.push([x - hx, y - hy, x + hx, y + hy]);
      boxes.push([gx - GW / 2, gy - GH / 2, gx + GW / 2, gy + GH / 2]);
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

/**
 * Précharge (en tâche de fond, quand le navigateur est libre) les images de toutes les cartes des decks en jeu :
 * une carte qui arrive au centre de la table pendant une animation s'affiche tout de suite au lieu d'apparaître vide.
 */
const preloaded = new Set<string>();
function usePreloadImages(decks: (string | null | undefined)[]) {
  const key = decks.join("|");
  useEffect(() => {
    const ids = DECKS.filter((d) => decks.includes(d.name)).flatMap((d) => [...d.cards, ...d.vcs]);
    const urls = [...new Set(ids.map(cardImage))].filter((u) => !preloaded.has(u));
    const idle = (cb: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(cb) : setTimeout(cb, 200));
    let i = 0;
    let stop = false;
    // Quelques images à la fois pour ne pas gêner le chargement du reste.
    const next = () => {
      if (stop) return;
      for (const u of urls.slice(i, i + 6)) {
        preloaded.add(u);
        const im = new Image();
        im.decoding = "async";
        im.src = u;
      }
      i += 6;
      if (i < urls.length) idle(next);
    };
    idle(next);
    return () => void (stop = true);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const [viewTerrain, setViewTerrain] = useState<string | null>(null);
  const [viewDeck, setViewDeck] = useState<string | null>(null);
  const [showGone, setShowGone] = useState(false);
  const [fresh] = useState(() => !!g.startedAt && Date.now() - g.startedAt < 15000 && g.round === 1 && g.turn === 0);
  const arena = useRef<HTMLDivElement>(null);
  const size = useSize(arena);
  const fx = useFx();
  // Fin de partie / vote : affichés seulement quand les animations (dont celle de la victoire) sont finies.
  const settled = useSettled(!fx.busy);

  const me = g.players[uid];
  // Un joueur qui a abandonné regarde la suite comme un spectateur.
  const isPlayer = !!me && !me.out;
  // Spectateur (ou joueur sorti sans équipe à aider) : il voit tout le plateau face visible.
  const spectating = !me || (!!me.out && !room.players[uid]?.team.trim());
  const current = E.currentPlayer(g);
  const myTurn = current === uid;
  const isHost = room.hostUid === uid;
  const auto = room.auto !== false;
  // Pas de pose pendant la phase 1 ni pendant une animation.
  const canPlay = isPlayer && myTurn && g.phase === "action" && !g.pending && !fx.busy;
  const moving: DragSrc | null = drag ?? placing;

  // Infos contextuelles : la météo n'est évoquée que si le deck Météo est en jeu.
  const decksInPlay = g.order.map((u) => room.players[u]?.deck);
  setShowWeather(decksInPlay.includes("Météo"));

  const run = (fn: (r: Room, g: GameState) => void) => act(room.code, fn).catch((e) => setErr((e as Error).message));
  const runAuto = (a: EffectAction) => effect(room.code, a).catch((e) => setErr((e as Error).message));

  const colorOf = (u: string) => playerColor(room, u);
  const myTeam = room.players[uid]?.team.trim();
  const myPrompt = g.pending?.prompt.chooser === uid && !fx.busy ? g.pending.prompt : null;
  const answerPrompt = (a: unknown) => effect(room.code, null, a).catch((e) => setErr((e as Error).message));
  const tablePick = useTablePick(g, myPrompt, answerPrompt, `${g.pending?.answers.length ?? -1}:${g.pending?.prompt.text ?? ""}`);

  useCardFlip(arena, g, fresh);
  usePreloadImages(decksInPlay);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPlacing(null);
        setDrag(null);
      }
    };
    // Petit clic sonore sur chaque bouton.
    const c = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest("button:not(:disabled), select, input[type=checkbox]")) sfx.click();
    };
    addEventListener("keydown", k);
    addEventListener("pointerdown", c);
    return () => {
      removeEventListener("keydown", k);
      removeEventListener("pointerdown", c);
    };
  }, []);

  // ----- Déroulé automatique du tour (exécuté par le client du joueur actif) -----
  // Son « c'est ton tour » : seulement chez le joueur dont c'est le tour.
  const turnKey = useRef("");
  useEffect(() => {
    const k = `${g.round}-${g.turn}`;
    if (turnKey.current === k) return;
    const first = turnKey.current === "";
    turnKey.current = k;
    if (!first && isPlayer && current === uid && room.status === "playing") sfx.myTurn();
  }, [g.round, g.turn, current, uid, isPlayer, room.status]);
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

  /** Défausse de la main (action du tour) : en mode auto, les passifs peuvent y réagir. */
  const discard = (id: string) =>
    auto ? runAuto({ t: "discard", by: uid, card: id }) : run((r, gg) => E.discardFromHand(r, gg, uid, id));

  // ----- Glisser-déposer -----
  const dropTerrain = (owner: string, index: number) => {
    const src = moving;
    setDrag(null);
    setPlacing(null);
    if (!src || !isPlayer || !myTurn || g.pending) return;
    if (src.from === "hand") {
      if (!canPlay || owner !== uid) return;
      if (me.cantPlay) return setErr(me.cantPlay);
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
    discard(src.id);
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
  const [gaugeOpen, setGaugeOpen] = useState<string | null>(null);
  // Flèches du sens de jeu : un arc entre chaque plateau et le suivant, qui suit le cercle des plateaux.
  const arrows = useMemo(() => {
    const n = seated.length;
    if (n < 2) return [];
    const rx = size.w * 0.37;
    const ry = size.h * 0.37;
    const half = Math.min(60, (360 / n) * 0.32); // demi-ouverture de l'arc (degrés)
    return seated.map((_, i) => {
      const mid = seatAngle(i, n) - 180 / n;
      const pts = Array.from({ length: 25 }, (_, k) => {
        const a = ((mid + half - (2 * half * k) / 24) * Math.PI) / 180;
        return `${(size.w / 2 + Math.cos(a) * rx).toFixed(1)},${(size.h / 2 + Math.sin(a) * ry).toFixed(1)}`;
      });
      return { d: `M${pts.join(" L")}` };
    });
  }, [seated.length, size.w, size.h]);
  const curSeat = seated.indexOf(current);
  // Cartes disparues : à quelqu'un au début de la partie, mais dans aucune zone ni sous une autre carte.
  const gone = useMemo(() => {
    const under = new Set(Object.values(g.under ?? {}).flat());
    return Object.keys(g.owner).filter((id) => !under.has(id) && !E.locate(g, id));
  }, [g]);
  const turnBack = room.players[current]?.deck ? deckBack(room.players[current].deck!) ?? cardImage(DECKS.find((d) => d.name === room.players[current].deck)?.cards[0] ?? "") : null;

  return (
    <div className="table">
      <header className="topbar">
        <span className="code">{room.code}</span>
        <span className={`badge ${auto ? "auto-badge" : ""}`} title={auto ? "Les cartes ⚙ s'appliquent toutes seules" : "Tous les effets sont manuels"}>
          {auto ? "⚙ Auto" : "✋ Manuel"}
        </span>
        <span className={`turn-chip ${myTurn && isPlayer ? "mine" : ""}`} style={{ ["--pc" as string]: colorOf(current) }}>
          {myTurn && isPlayer ? "▶ À vous de jouer !" : `▶ ${room.players[current]?.name}`}
        </span>
        <span className="steps">
          {(["activation", "action", "end"] as const).map((ph, i) => (
            <span key={ph} className={`step ${g.phase === ph ? "on" : ""}`}>{i + 1}. {PHASE_LABEL[ph]}</span>
          ))}
        </span>
        <TurnControls g={g} room={room} uid={uid} myTurn={myTurn && isPlayer} auto={auto} autoEnd={autoEnd} busy={fx.busy} run={run} runAuto={runAuto} />
        <span className="grow" />
        {!isPlayer && <span className="badge" title={spectating ? "Tu vois toutes les cartes face visible" : undefined}>{me?.out ? (room.kicked?.includes(uid) ? "🚫 Exclu" : "🏳 Abandon") : "Spectateur"}{spectating ? " · 👁 tout visible" : ""}</span>}
        <Dice run={run} uid={uid} enabled={isPlayer && myTurn} />
        <SoundControl />
        {gone.length > 0 && (
          <button className="ghost gone-btn" title="Cartes sorties de la partie" onClick={() => (sfx.click(), setShowGone(true))}>
            🕳 Disparues <b>{gone.length}</b>
          </button>
        )}
        <button className="ghost" onClick={() => (sfx.click(), setShowLog((v) => !v))}>📜 Journal</button>
        {isPlayer && room.status === "playing" && (
          <button
            className="ghost danger"
            title="Abandonner la partie : tes tours seront passés"
            onClick={() => {
              if (confirm("Abandonner la partie ? Tes tours seront passés et tu ne pourras plus gagner.")) run((r, gg) => E.forfeit(r, gg, uid));
            }}
          >
            🏳
          </button>
        )}
        <button className="ghost" onClick={() => (location.hash = "")}>Quitter</button>
      </header>
      <OrderBar g={g} room={room} uid={uid} colorOf={colorOf} />

      <div className={`arena ${moving ? "is-moving" : ""} ${tablePick.pick ? "is-picking" : ""}`} ref={arena}>
        {turnBack && (
          <div key={current} className="turn-backdrop" style={{ backgroundImage: `url("${turnBack}"), url("${PLACEHOLDER}")`, ["--pc" as string]: colorOf(current) }} />
        )}
        <div className="table-felt" />
        {arrows.length > 0 && (
          <svg className="turn-arrows" width={size.w} height={size.h} aria-hidden="true">
            <defs>
              <marker id="ta-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" className="ta-head" />
              </marker>
              <marker id="ta-head-on" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" className="ta-head on" />
              </marker>
            </defs>
            {arrows.map((a, i) => (
              <path key={i} d={a.d} className={`turn-arc ${i === curSeat ? "on" : ""}`} markerEnd={`url(#${i === curSeat ? "ta-head-on" : "ta-head"})`}>
                <title>{i === curSeat ? "Prochain tour" : "Sens du tour de table"}</title>
              </path>
            ))}
          </svg>
        )}
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
              faceUpHand={owner === uid || spectating}
              seeAll={spectating}
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
              onShowTerrain={setViewTerrain}
              onShowDeck={(o) => setViewDeck(room.players[o]?.deck ?? null)}
              pick={tablePick.pick}
            />
          ) : null,
        )}

        <div className="hub">
          <span className="small muted">Condition commune</span>
          <div data-vc="common">
            <CardView id={g.commonVC} size="s" onClick={() => setOpenCard(g.commonVC)} onHover={onHover} />
          </div>
        </div>

        {seated.map((owner, i) => {
          const s = layout[i];
          if (s?.gx === undefined || s.gy === undefined || !g.commonVC) return null;
          const t = E.teamKey(room, owner);
          const done = g.commonDone.includes(t);
          const prog = done ? null : vcProgress(room, g, g.commonVC, owner);
          const open = gaugeOpen === owner;
          return (
            <div key={`g-${owner}`} className={`seat-gauge ${open ? "open" : ""}`} style={{ left: s.gx, top: s.gy, width: GW, ["--pc" as string]: colorOf(owner) }}>
              <button
                className={`team-dot ${done ? "done" : ""}`}
                title="Voir le détail de la condition commune"
                onClick={() => (sfx.click(), setGaugeOpen(open ? null : owner))}
              >
                <span className="team-name">{done ? "✔ " : ""}{room.players[owner]?.name}</span>
                {done ? <span className="team-prog">remplie</span> : prog && <Gauge ratio={prog.ratio} />}
              </button>
              {open && (
                <div className="gauge-pop panel" onClick={(e) => e.stopPropagation()}>
                  <b>« {card(g.commonVC).name} »</b>
                  <span className="small muted">{card(g.commonVC).text}</span>
                  <span className="small">Équipe : <b style={{ color: colorOf(owner) }}>{E.teamLabel(room, t)}</b>{done ? " — ✔ remplie" : ""}</span>
                  {E.teamMembers(room, t).map((u) => {
                    const p = done ? null : vcProgress(room, g, g.commonVC, u);
                    return (
                      <div key={u} className="vc-prog">
                        <span className="small"><b style={{ color: colorOf(u) }}>{room.players[u]?.name}</b>{p ? ` — ${Math.round(p.ratio * 100)} %` : ""}</span>
                        {p && <Gauge ratio={p.ratio} />}
                        {p && <span className="small muted">{p.text}</span>}
                      </div>
                    );
                  })}
                  <button className="mini" onClick={() => setGaugeOpen(null)}>Fermer</button>
                </div>
              )}
            </div>
          );
        })}

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
      {showLog && <Log g={g} room={room} uid={uid} colorOf={colorOf} onClose={() => setShowLog(false)} />}

      {hover && !openCard && !drag && <HoverCard id={hover.id} x={hover.x} y={hover.y} preview={preview} auto={auto} nameOf={(u) => E.nameOf(room, u)} me={uid} noPlay={auto && me?.hand.includes(hover.id) ? me.cantPlay ?? noPlayReason(g, hover.id) : null} />}

      {openCard && (
        <CardModal
          id={openCard}
          onClaimWord={(w) => run((r, gg) => claimWord(r, gg, uid, w))}
          onDiscard={canPlay ? discard : undefined}
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
      {myPrompt && !onTable(myPrompt) && (
        <ChoiceModal key={g.pending!.answers.length} room={room} prompt={myPrompt} onAnswer={answerPrompt} onCard={setOpenCard} />
      )}
      {myPrompt && tablePick.pick && (
        <ChoiceDock room={room} g={g} prompt={myPrompt} pick={tablePick.pick} answer={tablePick.answer} onCard={setOpenCard} />
      )}
      <FxLayer g={g} room={room} me={uid} fresh={fresh} startDelay={fresh ? dealDuration(g) : 0} colorOf={colorOf} />
      {viewDeck && <DeckModal deck={viewDeck} onClose={() => setViewDeck(null)} />}
      {showGone && <GoneModal ids={gone} ownerName={(id) => E.nameOf(room, g.owner[id])} onCard={setOpenCard} onClose={() => setShowGone(false)} />}
      {viewTerrain && g.players[viewTerrain] && (
        <TerrainModal name={E.nameOf(room, viewTerrain)} terrain={g.players[viewTerrain].terrain} onCard={setOpenCard} onClose={() => setViewTerrain(null)} />
      )}
      {g.wordClaim && <WordVote room={room} uid={uid} />}
      {g.vote && settled && <VoteModal room={room} uid={uid} isHost={isHost} />}
      {room.status === "ended" && settled && <EndModal room={room} isHost={isHost} />}
    </div>
  );
}

/** Ordre du tour et durée de la partie, toujours visibles. */
function OrderBar({ g, room, uid, colorOf }: { g: GameState; room: Room; uid: string; colorOf: (u: string) => string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.floor((now - (g.startedAt ?? now)) / 1000));
  const hh = Math.floor(secs / 3600);
  const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  const current = E.currentPlayer(g);
  return (
    <div className="order-bar">
      <span className="ob-label">Ordre du tour</span>
      {g.order.map((u, i) => (
        <span key={u} className="ob-item">
          {i > 0 && <span className="ob-arrow">›</span>}
          <span
            className={`ob-player ${u === current ? "on" : ""} ${g.players[u]?.out ? "out" : ""} ${u === uid ? "me" : ""}`}
            style={{ ["--pc" as string]: colorOf(u) }}
            title={`d20 : ${g.rolls[u] ?? "?"}`}
          >
            {u === current && "▶ "}{E.nameOf(room, u)}
          </span>
        </span>
      ))}
      <span className="grow" />
      <span className="ob-stat" title="Numéro du tour de table">🔁 Tour {g.round}</span>
      <span className="ob-stat" title="Durée de la partie">⏱ {hh ? `${hh}:` : ""}{mm}:{ss}</span>
    </div>
  );
}

/** Vrai quand `ok` est resté vrai un court instant (les animations qui arrivent avec le même état ont le temps de démarrer). */
function useSettled(ok: boolean, delay = 500) {
  const [v, setV] = useState(ok);
  useEffect(() => {
    if (!ok) return setV(false);
    const t = setTimeout(() => setV(true), delay);
    return () => clearTimeout(t);
  }, [ok, delay]);
  return v && ok;
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
        {g.players[uid].cantPlay ? `🤧 ${g.players[uid].cantPlay}`
          : g.players[uid].hand.length ? "Glisse une carte de ta main sur ton terrain (pose) ou sur ta défausse" : "Main vide"}
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
        E.pushFx(g, { k: "dice", uid, faces: 4, value: v, bh: true });
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

/** Type d'action d'une ligne du journal : icône, couleur et nom. */
const LOG_KINDS: [RegExp, string, string, string][] = [
  [/^—/, "▶", "turn", "Nouveau tour"],
  [/^🏆|condition.*remplie|^🏁/i, "🏁", "vc", "Condition de victoire"],
  [/^🏳/, "🏳", "out", "Abandon"],
  [/^🎲|lance(nt)? (un|le) d/i, "🎲", "dice", "Dé"],
  [/effet impossible|ne peut pas/i, "✖", "fail", "Effet impossible"],
  [/^🔀|mélang/i, "🔀", "shuffle", "Mélange"],
  [/^🔗/, "🔗", "link", "Carte qui agit sur une carte"],
  [/^🔒|^🔓/, "🔒", "lock", "Blocage"],
  [/^🔤/, "🔤", "word", "The Word"],
  [/ pose /i, "⤵", "play", "Pose"],
  [/active|^✨/i, "✨", "activate", "Activation"],
  [/défauss/i, "🗑", "discard", "Défausse"],
  [/pioche/i, "📥", "draw", "Pioche"],
  [/gold/i, "💰", "gold", "Gold"],
  [/trou noir/i, "🌀", "bh", "Trou noir"],
  [/sentience/i, "🧠", "sent", "Sentience"],
  [/main/i, "✋", "hand", "Main"],
];
const logKind = (t: string) => LOG_KINDS.find(([re]) => re.test(t)) ?? null;

type LogFilter = "all" | "turn" | "me";
function Log({ g, room, uid, colorOf, onClose }: { g: GameState; room: Room; uid: string; colorOf: (u: string) => string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<LogFilter>("all");
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [g.log.length, filter]);
  // « Ce tour » : depuis la dernière ligne de début de tour. « Me concerne » : mes cartes, ou moi comme acteur ou cible.
  const lines = useMemo(() => {
    if (filter === "turn") {
      let start = 0;
      g.log.forEach((l, i) => l.text.startsWith("—") && (start = i));
      return g.log.slice(start);
    }
    if (filter === "me") {
      const name = E.nameOf(room, uid);
      return g.log.filter(
        (l) => l.text.startsWith("—") || l.from === uid || l.to === uid || (l.src && g.owner[l.src] === uid) || (l.dst && g.owner[l.dst] === uid) || l.text.includes(name),
      );
    }
    return g.log;
  }, [g.log, g.owner, filter, room, uid]);
  const who = (u?: string) =>
    u && g.players[u] ? <span className="log-who" style={{ ["--pc" as string]: colorOf(u) }}>{E.nameOf(room, u)}</span> : null;
  return (
    <aside className="log-drawer panel">
      <div className="row">
        <h3 className="grow">Journal</h3>
        <VersionTag />
        <button className="ghost" onClick={onClose}>✕</button>
      </div>
      <div className="log-filters">
        {([["all", "Tout"], ["turn", "Ce tour"], ["me", "Me concerne"]] as [LogFilter, string][]).map(([k, label]) => (
          <button key={k} className={`mini ${filter === k ? "primary" : ""}`} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>
      <div className="log-body" ref={ref}>
        {lines.map((l, i) => {
          const cls = l.text.startsWith("—") ? "log-turn" : l.text.startsWith("🎲") ? "log-dice" : l.dst || (l.to && l.to !== l.from) ? "log-link" : "";
          return (
            <div key={i} className={`log-entry ${cls}`}>
              {(l.src || l.dst) && (
                <div className="log-flow">
                  {l.src && <CardView id={l.src} size="xs" ghost />}
                  {who(l.from)}
                  {l.dst && <span className="log-arrow">➜</span>}
                  {l.dst && <CardView id={l.dst} size="xs" ghost />}
                  {l.to && l.to !== l.from && who(l.to)}
                </div>
              )}
              <p>
                {(() => {
                  const k = logKind(l.text);
                  return k ? <span className={`log-ico k-${k[2]}`} title={k[3]}>{k[1]}</span> : null;
                })()}
                {l.text}
              </p>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/** Vote des autres joueurs sur le mot proposé pour « The Word ». */
function WordVote({ room, uid }: { room: Room; uid: string }) {
  const c = room.game!.wordClaim!;
  const voters = room.game!.order.filter((u) => u !== c.uid);
  const yes = voters.filter((u) => c.votes[u] === true).length;
  const no = voters.filter((u) => c.votes[u] === false).length;
  const canVote = voters.includes(uid);
  const vote = (ok: boolean) => act(room.code, (r, gg) => voteWord(r, gg, uid, ok));
  return (
    <div className="floating-banner word-vote">
      🔤 <b>{E.nameOf(room, c.uid)}</b> propose « <b>{c.word}</b> » (The Word).
      {canVote ? (
        <>
          <button className={c.votes[uid] === true ? "primary" : ""} onClick={() => vote(true)}>✔ Valide ({yes})</button>
          <button className={c.votes[uid] === false ? "primary" : ""} onClick={() => vote(false)}>✖ Refusé ({no})</button>
        </>
      ) : (
        <span className="muted"> Vote en cours : {yes} oui · {no} non</span>
      )}
    </div>
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
        {last && <WinRecap r={last} />}
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

/** Résumé de victoire : conditions remplies et dernières actions qui y ont mené. */
function WinRecap({ r }: { r: GameState["ranking"][number] }) {
  if (!r.vcs?.length && !r.recap?.length) return null;
  return (
    <div className="win-recap">
      {!!r.vcs?.length && (
        <div className="win-vcs">
          {r.vcs.map((id) => (
            <div key={id} className="win-vc" title={card(id).text}>
              ✔ <b>{card(id).name}</b> <span className="small muted">{card(id).text}</span>
            </div>
          ))}
        </div>
      )}
      {!!r.recap?.length && (
        <>
          <div className="small muted">Les dernières actions avant la victoire :</div>
          <ol className="win-steps">
            {r.recap.map((t, i) => <li key={i} style={{ animationDelay: `${i * 120}ms` }}><KwText text={t} /></li>)}
          </ol>
        </>
      )}
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
