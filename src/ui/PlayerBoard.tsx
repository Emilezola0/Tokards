import type { DragEvent, MouseEvent } from "react";
import { card } from "../data/cards";
import * as E from "../game/engine";
import type { GameState, Room } from "../game/types";
import { BLACK_HOLES, showWeather } from "../game/types";
import { isAutomated, type Preview } from "../effects/runtime";
import CardView, { CardBack } from "./CardView";
import { useFx } from "./fxStore";

/** Dimensions fixes d'un plateau (avant mise à l'échelle). */
export const BW = 600;
export const BH = 404;
const GRID_W = BW - 24;
const GRID_H = 210;
const GAP = 6;

function gridFor(n: number) {
  for (let rows = 2; ; rows++) {
    const ch = (GRID_H - (rows - 1) * GAP) / rows;
    const cw = (ch * 2) / 3;
    const cols = Math.max(1, Math.floor((GRID_W + GAP) / (cw + GAP)));
    if (cols * rows >= n || rows >= 10) return { rows, cols, cw };
  }
}

export type Seat = { x: number; y: number; rot: number; s: number };
export type DragSrc = { id: string; from: "hand" | "terrain" | "discard" };

export function Odometer({ value }: { value: number }) {
  const neg = value < 0;
  const digits = String(Math.abs(value)).padStart(5, "0").split("");
  return (
    <span className="odo" aria-label={`${value} gold`}>
      {neg && <span className="odo-neg">−</span>}
      {digits.map((d, i) => (
        <span key={digits.length - i} className="odo-digit">
          <span className="odo-strip" style={{ transform: `translateY(${-Number(d) * 10}%)` }}>
            {"0123456789".split("").map((x) => <span key={x}>{x}</span>)}
          </span>
        </span>
      ))}
    </span>
  );
}

type Props = {
  room: Room;
  g: GameState;
  owner: string;
  uid: string;
  seat: Seat;
  color: string;
  ally: boolean;
  auto: boolean;
  faceUpHand: boolean;
  /** carte en cours de déplacement (glisser ou « poser… ») */
  moving: DragSrc | null;
  canDropHere: boolean;
  canDragHand: boolean;
  canDragTerrain: boolean;
  preview: Preview | null;
  onCard: (id: string) => void;
  onPlayer: (owner: string) => void;
  onHover: (id: string | null, e?: MouseEvent) => void;
  onDropTerrain: (owner: string, index: number) => void;
  onDropDiscard: (owner: string) => void;
  onDragStart: (src: DragSrc) => void;
  onDragEnd: () => void;
};

export default function PlayerBoard(p: Props) {
  const { room, g, owner, uid, seat, color, auto, preview, moving } = p;
  const st = g.players[owner];
  const held = useFx().held[owner] ?? {};
  const gold = held.gold ?? st.gold;
  const sentience = held.sentience ?? st.sentience;
  const bhId = held.bh ?? st.blackHole;
  const bh = BLACK_HOLES.find((b) => b.id === bhId);
  const lobbyP = room.players[owner];
  const current = E.currentPlayer(g);
  const nextCard = g.phase === "activation" && owner === current ? E.nextActivation(g) : undefined;
  const ranked = g.ranking.findIndex((r) => r.team === E.teamKey(room, owner));
  const grid = gridFor(st.terrain.length + 1);
  const cells = Math.max(grid.cols * grid.rows, st.terrain.length + 1);
  const handW = BW - 24 - 2 * 68 - 2 * 12;
  const handCw = Math.min(64, (handW - (st.hand.length - 1) * 6) / Math.max(1, st.hand.length));
  const dropping = !!moving && p.canDropHere;
  const tgt = (k: keyof Preview, v: string) => !!preview && (preview[k] as string[] | undefined)?.includes(v);

  const drag = (src: DragSrc) => (e: DragEvent) => {
    e.dataTransfer.setData("text/plain", src.id);
    e.dataTransfer.effectAllowed = "move";
    p.onDragStart(src);
  };
  const allow = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    (e.currentTarget as HTMLElement).classList.add("over");
  };
  const leave = (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove("over");
  const drop = (fn: () => void) => (e: DragEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove("over");
    fn();
  };

  const top = st.discard[0];
  const vc = st.personalVC;
  return (
    <section
      data-board={owner}
      data-rot={seat.rot}
      data-scale={seat.s}
      className={`board ${owner === current ? "active" : ""} ${owner === uid ? "mine" : ""} ${p.ally ? "ally" : ""} ${tgt("players", owner) ? "target" : ""}`}
      style={{
        width: BW, height: BH, left: seat.x, top: seat.y,
        transform: `translate(-50%, -50%) rotate(${seat.rot}deg) scale(${seat.s})`,
        ["--pc" as string]: color,
      }}
    >
      <header className="board-head">
        <span className="pdot" />
        <strong className="pname">{lobbyP?.name}{owner === uid && " (toi)"}</strong>
        <span className="muted small">{lobbyP?.team ? `Équipe ${lobbyP.team}` : "Solo"} · {lobbyP?.deck}</span>
        {p.ally && <span className="badge ally-badge">Allié</span>}
        {ranked >= 0 && <span className="badge gold-badge">🏆 {ranked + 1}</span>}
        {owner === current && <span className="badge turn-badge">▶ Son tour</span>}
      </header>

      <div
        className={`grid ${dropping ? "dropping" : ""}`}
        style={{ gridTemplateColumns: `repeat(${grid.cols}, ${grid.cw}px)`, ["--cw" as string]: `${grid.cw}px` }}
      >
        {Array.from({ length: cells }, (_, i) => {
          const id = st.terrain[i];
          const index = Math.min(i, st.terrain.length);
          const isDrop = dropping && !(moving?.from === "terrain" && moving.id === id);
          return (
            <div
              key={id ?? `e${i}`}
              className={`cell ${id ? "full" : ""} ${isDrop ? "drop-ok" : ""}`}
              onDragOver={isDrop ? allow : undefined}
              onDragLeave={isDrop ? leave : undefined}
              onDrop={isDrop ? drop(() => p.onDropTerrain(owner, index)) : undefined}
              onClick={isDrop && !id ? () => p.onDropTerrain(owner, index) : undefined}
            >
              {id && (
                <CardView
                  id={id}
                  size="s"
                  badge={String(i + 1)}
                  highlight={id === nextCard}
                  target={tgt("cards", id)}
                  auto={auto && isAutomated(id)}
                  selected={moving?.id === id}
                  draggable={p.canDragTerrain}
                  onDragStart={drag({ id, from: "terrain" })}
                  onDragEnd={p.onDragEnd}
                  onHover={p.onHover}
                  onClick={() => (isDrop ? p.onDropTerrain(owner, index) : p.onCard(id))}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="board-row">
        <div className="pile" data-pile={`deck:${owner}`} title={`Pioche : ${st.deck.length} carte(s)`}>
          {st.deck.length ? (
            <CardBack deck={st.deck[0] ? card(st.deck[0]).deck : lobbyP?.deck ?? undefined} size="s" count={st.deck.length} />
          ) : (
            <div className="card s empty-slot">Pioche vide</div>
          )}
        </div>

        <div className="hand" data-pile={`hand:${owner}`} style={{ ["--hw" as string]: `${handCw}px` }}>
          {st.hand.map((id) =>
            p.faceUpHand ? (
              <CardView
                key={id}
                id={id}
                size="s"
                target={tgt("cards", id)}
                selected={moving?.id === id}
                draggable={p.canDragHand}
                onDragStart={drag({ id, from: "hand" })}
                onDragEnd={p.onDragEnd}
                onHover={p.onHover}
                onClick={() => p.onCard(id)}
              />
            ) : (
              <CardBack key={id} id={id} size="s" />
            ),
          )}
          {!st.hand.length && <span className="muted small">Main vide</span>}
        </div>

        <div
          className={`pile discard ${moving?.from === "hand" && owner === uid ? "drop-ok" : ""}`}
          data-pile={`discard:${owner}`}
          title="Défausse : cliquer pour la voir"
          onDragOver={moving?.from === "hand" && owner === uid ? allow : undefined}
          onDragLeave={leave}
          onDrop={drop(() => p.onDropDiscard(owner))}
        >
          {top ? (
            <CardView id={top} size="s" target={tgt("cards", top)} onHover={p.onHover} onClick={() => p.onPlayer(owner)} />
          ) : (
            <button className="card s empty-slot" onClick={() => p.onPlayer(owner)}>Défausse</button>
          )}
          <span className="pile-count">{st.discard.length}</span>
        </div>
      </div>

      <footer className="res-bar">
        <button className="res-group" onClick={() => p.onPlayer(owner)} title="Ressources (outils manuels)">
          <span className={`res sent ${sentience ? "on" : "off"} ${tgt("sentience", owner) ? "target" : ""}`} data-sent={owner} title={`Sentience ${sentience ? "Vraie" : "Fausse"}`}>
            🧠<small>{sentience ? "Vraie" : "Fausse"}</small>
          </span>
          <span className={`res bh ${tgt("bh", owner) ? "target" : ""}`} data-bh={owner} title="Trou noir">
            🌀 {bhId}{showWeather() && bh && <small> {bh.icon}</small>}
          </span>
          <span className={`res gold ${tgt("gold", owner) ? "target" : ""}`} data-gold={owner}>
            <Odometer value={gold} /> 💰
          </span>
        </button>
        {vc && (
          <button className={`vc-chip ${st.personalDone ? "vc-done" : ""}`} data-vc={owner} onClick={() => p.onCard(vc)} onMouseEnter={(e) => p.onHover(vc, e)} onMouseLeave={() => p.onHover(null)}>
            <span className="vc-flag">🏁</span>
            <span className="vc-name">{card(vc).name}</span>
          </button>
        )}
      </footer>
    </section>
  );
}
