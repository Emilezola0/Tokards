import { useState, type DragEvent, type MouseEvent } from "react";
import { card } from "../data/cards";
import * as E from "../game/engine";
import type { GameState, Room } from "../game/types";
import { BLACK_HOLES, showWeather } from "../game/types";
import { isAutomated, type Preview } from "../effects/runtime";
import { vcProgress } from "../game/victory";
import CardView, { CardBack } from "./CardView";
import { useFx } from "./fxStore";
import { sfx } from "./sfx";

/** Dimensions fixes d'un plateau (avant mise à l'échelle). */
export const BW = 600;
export const BH = 418;
const SIDE = 34; // colonne du bouton « effets du terrain »
const GRID_W = BW - 24 - SIDE;
const GRID_H = 210;
const GAP = 6;
const PILE = 68;
const HAND_W = BW - 24 - 2 * PILE - 2 * 12;
const HAND_CARD = 64;

function gridFor(n: number) {
  for (let rows = 2; ; rows++) {
    const ch = (GRID_H - (rows - 1) * GAP) / rows;
    const cw = (ch * 2) / 3;
    const cols = Math.max(1, Math.floor((GRID_W + GAP) / (cw + GAP)));
    if (cols * rows >= n || rows >= 10) return { rows, cols, cw };
  }
}

export type Seat = { x: number; y: number; rot: number; s: number };
/** Choix en cours sur la table : joueurs / cartes / place sélectionnables, le reste verrouillé. */
export type PickState = {
  kind: "player" | "cards" | "slot";
  players: string[];
  cards: string[];
  picked: string[];
  blind?: boolean;
  slotUid?: string;
  slotCard?: string;
  onPlayer: (u: string) => void;
  onCard: (id: string) => void;
  onSlot: (index: number) => void;
};
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

/** Jauge d'avancement d'une condition de victoire. */
export function Gauge({ ratio, done }: { ratio: number; done?: boolean }) {
  return (
    <span className={`gauge ${done ? "done" : ""}`}>
      <span style={{ width: `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%` }} />
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
  onShowTerrain: (owner: string) => void;
  onShowDeck: (owner: string) => void;
  pick?: PickState | null;
};

export default function PlayerBoard(p: Props) {
  const { room, g, owner, uid, seat, color, auto, preview, moving } = p;
  const st = g.players[owner];
  const held = useFx().held[owner] ?? {};
  const [handOpen, setHandOpen] = useState(false);
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
  const n = st.hand.length;
  // Trop de cartes : elles se chevauchent (superposition).
  const fits = n * HAND_CARD + (n - 1) * 6 <= HAND_W;
  const overlap = fits || n < 2 ? 6 : (HAND_W - n * HAND_CARD) / (n - 1);
  const dropping = !!moving && p.canDropHere;
  const tgt = (k: keyof Preview, v: string) => !!preview && (preview[k] as string[] | undefined)?.includes(v);
  const vc = st.personalVC;
  const prog = vc ? vcProgress(room, g, vc, owner) : null;
  const pick = p.pick ?? null;
  const pickCards = pick?.kind === "cards";
  const slotHere = pick?.kind === "slot" && pick.slotUid === owner;
  const pickCls = !pick ? "" : pick.kind === "player" ? (pick.players.includes(owner) ? "pick-ok" : "pick-no")
    : pick.kind === "slot" ? (slotHere ? "pick-slot" : "pick-no") : "picking";
  /** Propriétés d'une carte visible pendant un choix de cartes. */
  const pickProps = (id: string) => {
    if (!pickCards) return {};
    const ok = pick!.cards.includes(id);
    return { locked: !ok, selected: pick!.picked.includes(id), onClick: ok ? () => pick!.onCard(id) : () => {} };
  };

  const drag = (src: DragSrc) => (e: DragEvent) => {
    e.dataTransfer.setData("text/plain", src.id);
    e.dataTransfer.effectAllowed = "move";
    setHandOpen(false);
    sfx.pick();
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
    sfx.drop();
    fn();
  };

  const top = st.discard[0];
  const under = st.discard.slice(1, 3);
  const deckLayers = Math.min(3, Math.max(0, st.deck.length - 1));
  return (
    <section
      data-board={owner}
      data-rot={seat.rot}
      data-scale={seat.s}
      className={`board ${pickCls} ${owner === current ? "active" : ""} ${st.out ? "out" : ""} ${owner === uid ? "mine" : ""} ${p.ally ? "ally" : ""} ${tgt("players", owner) ? "target" : ""}`}
      style={{
        width: BW, height: BH, left: seat.x, top: seat.y,
        transform: `translate(-50%, -50%) rotate(${seat.rot}deg) scale(${seat.s})`,
        ["--pc" as string]: color,
      }}
    >
      {pick?.kind === "player" && pick.players.includes(owner) && (
        <button className="pick-overlay" onClick={() => pick.onPlayer(owner)}>
          <span>Choisir {lobbyP?.name}{owner === uid && " (toi)"}</span>
        </button>
      )}
      <header className="board-head">
        <span className="pdot" />
        <strong className="pname">{lobbyP?.name}{owner === uid && " (toi)"}</strong>
        <span className="muted small">{lobbyP?.team ? `Équipe ${lobbyP.team}` : "Solo"} · {lobbyP?.deck}</span>
        {p.ally && <span className="badge ally-badge">Allié</span>}
        {ranked >= 0 && <span className="badge gold-badge">🏆 {ranked + 1}</span>}
        {st.locked && <span className="badge lock-badge" title="Sentience et trou noir bloqués jusqu'à son prochain tour">🔒</span>}
        {st.out && <span className="badge out-badge">🏳 Abandon</span>}
        {owner === current && (owner === uid
          ? <span className="badge turn-badge my-turn">▶ À vous de jouer !</span>
          : <span className="badge turn-badge">▶ Son tour</span>)}
        <span className="grow" />
        <button className="mini" title="Voir toutes les cartes du deck" onClick={() => p.onShowDeck(owner)}>🂠 Deck</button>
      </header>

      <div className="terrain-row">
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
                className={`cell ${id ? "full" : ""} ${isDrop ? "drop-ok" : ""} ${slotHere && i <= st.terrain.length ? "slot-ok" : ""}`}
                title={slotHere && i <= st.terrain.length ? (id ? `Poser avant « ${card(id).name} » (place ${i + 1})` : `Poser à la fin (place ${i + 1})`) : undefined}
                onDragOver={isDrop ? allow : undefined}
                onDragLeave={isDrop ? leave : undefined}
                onDrop={isDrop ? drop(() => p.onDropTerrain(owner, index)) : undefined}
                onClickCapture={slotHere && i <= st.terrain.length ? (e) => (e.stopPropagation(), pick!.onSlot(index)) : undefined}
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
                    spent={(g.spent ?? []).includes(id)}
                    store={g.cardStore?.[id]}
                    disabled={E.isDisabled(g, id)}
                    under={g.under?.[id]}
                    extraSent={g.tempTags?.includes(id)}
                    selected={moving?.id === id}
                    draggable={p.canDragTerrain}
                    onDragStart={drag({ id, from: "terrain" })}
                    onDragEnd={p.onDragEnd}
                    onHover={p.onHover}
                    onClick={() => (isDrop ? p.onDropTerrain(owner, index) : p.onCard(id))}
                    {...pickProps(id)}
                  />
                )}
              </div>
            );
          })}
        </div>
        <button className="side-btn" title="Voir tous les effets du terrain dans l'ordre" onClick={() => p.onShowTerrain(owner)} disabled={!st.terrain.length}>
          <span>📜</span>
          <span className="side-label">Effets</span>
        </button>
      </div>

      <div className="board-row">
        <div className="pile" data-pile={`deck:${owner}`} title={`Pioche : ${st.deck.length} carte(s)`}>
          {st.deck.length ? (
            <div className={`stack layers-${deckLayers}`}>
              <CardBack deck={card(st.deck[0]).deck} size="s" count={st.deck.length} />
            </div>
          ) : (
            <div className="card s empty-slot">Pioche vide</div>
          )}
        </div>

        <div
          className={`hand ${!fits ? "fanned" : ""} ${p.faceUpHand && !fits ? "expandable" : ""}`}
          data-pile={`hand:${owner}`}
          style={{ ["--ov" as string]: `${overlap}px` }}
          onClick={(e) => {
            if (p.faceUpHand && !fits && e.target === e.currentTarget) setHandOpen(true);
          }}
          title={p.faceUpHand && !fits ? "Cliquer pour étaler la main" : undefined}
        >
          {st.hand.map((id, i) => {
            const tilt = !fits ? (i - (n - 1) / 2) * 2.5 : 0;
            return (
              <span key={id} className="hand-slot" style={{ ["--tilt" as string]: `${tilt}deg`, zIndex: i }}>
                {p.faceUpHand ? (
                  <CardView
                    id={id}
                    size="s"
                    target={tgt("cards", id)}
                    selected={moving?.id === id}
                    draggable={p.canDragHand}
                    onDragStart={drag({ id, from: "hand" })}
                    onDragEnd={p.onDragEnd}
                    onHover={p.onHover}
                    onClick={() => (!fits ? setHandOpen(true) : p.onCard(id))}
                    {...pickProps(id)}
                  />
                ) : g.revealed?.includes(id) ? (
                  <CardView id={id} size="s" badge="👁" onHover={p.onHover} onClick={() => p.onCard(id)} {...pickProps(id)} />
                ) : pickCards && pick!.cards.includes(id) ? (
                  <span className="pickable-back"><CardBack id={id} size="s" selected={pick!.picked.includes(id)} onClick={() => pick!.onCard(id)} /></span>
                ) : (
                  <CardBack id={id} size="s" />
                )}
              </span>
            );
          })}
          {!n && <span className="muted small">Main vide</span>}
        </div>

        <div
          className={`pile discard ${moving?.from === "hand" && owner === uid ? "drop-ok" : ""}`}
          data-pile={`discard:${owner}`}
          title="Défausse : cliquer pour la voir"
          onDragOver={moving?.from === "hand" && owner === uid ? allow : undefined}
          onDragLeave={leave}
          onDrop={drop(() => p.onDropDiscard(owner))}
        >
          {under.reverse().map((id, i) => (
            <span key={id} className={`under under-${under.length - i}`}>
              <CardView id={id} size="s" ghost />
            </span>
          ))}
          {top ? (
            <CardView id={top} size="s" target={tgt("cards", top)} onHover={p.onHover} onClick={() => p.onPlayer(owner)} {...pickProps(top)} />
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
        {vc && !st.personalDone && (
          <button
            className="vc-chip"
            data-vc={owner}
            onClick={() => p.onCard(vc)}
            onMouseEnter={(e) => p.onHover(vc, e)}
            onMouseLeave={() => p.onHover(null)}
            title={prog?.text}
          >
            <span className="vc-line">
              <span className="vc-flag">🏁</span>
              <span className="vc-name">{card(vc).name}</span>
              {prog && <span className="vc-pct">{Math.round(prog.ratio * 100)}%</span>}
            </span>
            {prog && <Gauge ratio={prog.ratio} />}
            {prog && <span className="vc-text">{prog.text}</span>}
          </button>
        )}
        {vc && st.personalDone && (
          <button className="vc-chip vc-done" data-vc={owner} title={`« ${card(vc).name} » remplie : cliquer pour revoir la carte`} onClick={() => p.onCard(vc)}>
            🏁 ✔ <span className="vc-name">{card(vc).name}</span>
          </button>
        )}
      </footer>

      {handOpen && p.faceUpHand && (
        <div className="hand-grid-bg" onClick={() => setHandOpen(false)}>
          <div className="hand-grid panel" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <strong className="grow">Ta main ({n})</strong>
              <button className="ghost" onClick={() => setHandOpen(false)}>Refermer</button>
            </div>
            <div className="hand-grid-cards" onClick={() => setHandOpen(false)}>
              {st.hand.map((id) => (
                <CardView
                  key={id}
                  id={id}
                  size="m"
                  ghost
                  draggable={p.canDragHand}
                  onDragStart={drag({ id, from: "hand" })}
                  onDragEnd={p.onDragEnd}
                  onClick={() => {
                    setHandOpen(false);
                    p.onCard(id);
                  }}
                />
              ))}
            </div>
            <p className="small muted">Clique une carte pour la choisir, ou glisse-la sur ton terrain.</p>
          </div>
        </div>
      )}
    </section>
  );
}
