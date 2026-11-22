import type { DragEvent, MouseEvent } from "react";
import { PLACEHOLDER, card, cardImage, claudeMark, deckBack, tagIcons } from "../data/cards";
import { deckColor } from "./pose";
import { useEffect, useRef, useState } from "react";

/** true pendant un court instant quand la carte redevient jouable (animation de recharge). */
function useRecharge(spent: boolean) {
  const was = useRef(spent);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (was.current && !spent) {
      setOn(true);
      const t = setTimeout(() => setOn(false), 1100);
      was.current = spent;
      return () => clearTimeout(t);
    }
    was.current = spent;
  }, [spent]);
  return on;
}

type Props = {
  id?: string;
  hidden?: boolean;
  /** deck affiché au dos (sinon celui de la carte) */
  deck?: string;
  size?: "xs" | "s" | "m" | "l";
  highlight?: boolean;
  /** cible de l'effet survolé */
  target?: boolean;
  selected?: boolean;
  done?: boolean;
  /** effet automatique en mode auto */
  auto?: boolean;
  onClick?: () => void;
  badge?: string;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: () => void;
  onHover?: (id: string | null, e?: MouseEvent) => void;
  /** pas de data-card (copie affichée ailleurs, ex. aperçu) */
  ghost?: boolean;
  /** a joué son effet : grisée jusqu'à ce qu'elle puisse le rejouer */
  spent?: boolean;
  /** gold stockés sur la carte */
  /** valeur gardée par la carte (gold de côté, compteur…) : voir stored.ts */
  store?: { short: string; label: string } | null;
  /** verrouillée : ne peut pas être choisie */
  locked?: boolean;
  /** désactivée : son effet et ses passifs ne fonctionnent pas */
  disabled?: boolean;
  /** cartes placées sous celle-ci */
  under?: string[];
  /** tag 🧠 ajouté jusqu'à la fin du tour */
  extraSent?: boolean;
  /** déplacement bloqué : chaînes qui la lient au sol (texte = raison) */
  chained?: string;
  /** carte en main qu'on ne peut pas poser maintenant (texte = raison) */
  noPlay?: string | null;
};

/** Maillons d'une chaîne entre deux points (repère 0-100 × 0-150 de la carte). */
function chainLinks(x1: number, y1: number, x2: number, y2: number, n: number) {
  const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 0.5) / n;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    return i % 2 ? (
      <rect key={i} x={x - 5} y={y - 1.1} width={10} height={2.2} rx={1.1} transform={`rotate(${ang} ${x} ${y})`} className="lk-side" />
    ) : (
      <ellipse key={i} cx={x} cy={y} rx={6} ry={3.4} transform={`rotate(${ang} ${x} ${y})`} className="lk-face" />
    );
  });
}

/** Deux chaînes qui partent du bas de la carte et l'attachent au sol, avec leurs piquets. */
function Chains({ why }: { why: string }) {
  return (
    <span className="card-chains" title={`🔗 Enchaînée : ${why}`}>
      <svg viewBox="0 0 100 190" preserveAspectRatio="none" aria-hidden="true">
        <g className="chain">{chainLinks(14, 118, -6, 182, 8)}</g>
        <g className="chain">{chainLinks(86, 118, 106, 182, 8)}</g>
        <path className="stake" d="M-12 178 h12 l-6 10 z" />
        <path className="stake" d="M100 178 h12 l-6 10 z" />
        <circle className="ring" cx={14} cy={118} r={4} />
        <circle className="ring" cx={86} cy={118} r={4} />
      </svg>
      <span className="chain-lock">🔒</span>
    </span>
  );
}

export function CardBack({ deck, size = "m", selected, onClick, id, count }: {
  deck?: string; size?: Props["size"]; selected?: boolean; onClick?: () => void; id?: string; count?: number;
}) {
  const name = deck ?? (id ? card(id).deck : "Tokards");
  const img = deckBack(name);
  return (
    <button
      type="button"
      data-card={id}
      className={`card back ${size} ${selected ? "selected" : ""} ${img ? "has-img" : ""}`}
      style={{ ["--deck" as string]: deckColor(name), ...(img ? { backgroundImage: `url("${img}")` } : {}) }}
      onClick={onClick}
      title={id ? "Carte face cachée" : undefined}
    >
      {!img && <span className="hole small-hole" />}
      <span className="back-name">{name}</span>
      {count !== undefined && <span className="pile-count">{count}</span>}
    </button>
  );
}

export default function CardView(p: Props) {
  const { id, hidden, size = "m", highlight, target, selected, done, auto, onClick, badge, ghost, spent, store, locked, disabled, under, extraSent, chained, noPlay } = p;
  const recharged = useRecharge(!!spent);
  if (hidden || !id) return <CardBack id={ghost ? undefined : id} deck={p.deck} size={size} selected={selected} onClick={onClick} />;
  const c = card(id);
  const mark = claudeMark(c);
  return (
    <button
      type="button"
      data-card={ghost ? undefined : id}
      className={`card ${size} ${c.kind === "victory" ? "victory" : ""} ${highlight ? "highlight" : ""} ${target ? "target" : ""} ${selected ? "selected" : ""} ${done ? "done" : ""} ${c.trigger === "Passif" ? "passive" : ""} ${spent ? "spent" : ""} ${recharged ? "recharged" : ""} ${locked ? "locked" : ""} ${disabled ? "disabled" : ""} ${under?.length ? "has-under" : ""} ${chained ? "chained" : ""} ${noPlay ? "unplayable" : ""}`}
      onClick={onClick}
      draggable={p.draggable}
      onDragStart={p.onDragStart}
      onDragEnd={p.onDragEnd}
      onMouseEnter={p.onHover ? (e) => p.onHover!(id, e) : undefined}
      onMouseLeave={p.onHover ? () => p.onHover!(null) : undefined}
    >
      <img src={cardImage(id)} alt="" loading="lazy" draggable={false} onError={(e) => (e.currentTarget.src = PLACEHOLDER)} />
      <span className="card-tags">{c.kind === "victory" ? "🏁" : tagIcons(extraSent ? { ...c.tags, sentience: true } : c.tags)}{extraSent && !c.tags.sentience && <i className="tag-extra" title="Tag 🧠 ajouté jusqu'à la fin du tour">+</i>}</span>
      {badge && <span className="card-badge">{badge}</span>}
      {auto && <span className="card-auto" title="Effet automatique">⚙</span>}
      {c.trigger === "Passif" && <span className="card-passive" title={`Passif : ${c.event}`}>✨</span>}
      {mark && <span className="card-claude" title={mark.label}>{mark.icon}</span>}
      <span className="card-name">{c.name}</span>
      {spent && <span className="card-spent" title="Effet déjà joué : se recharge au prochain tour de son joueur">✓</span>}
      {!!store && <span className="card-store" title={`${store.label} (détail : cliquer sur la carte)`}>{store.short}</span>}
      {locked && <span className="card-lock">🔒</span>}
      {disabled && <span className="card-disabled" title="Désactivée : son effet et ses passifs ne fonctionnent pas">⛔</span>}
      {chained && <Chains why={chained} />}
      {noPlay && <span className="card-noplay" title={`Impossible à poser : ${noPlay}`}>🚫</span>}
      {!!under?.length && (
        <span className="card-under" title={`Dessous : ${under.map((u) => card(u).name).join(", ")}`}>
          ⤵ {under.length}
        </span>
      )}
    </button>
  );
}
