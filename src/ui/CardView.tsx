import type { DragEvent, MouseEvent } from "react";
import { PLACEHOLDER, card, cardImage, tagIcons } from "../data/cards";
import { deckColor } from "./pose";

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
};

export function CardBack({ deck, size = "m", selected, onClick, id, count }: {
  deck?: string; size?: Props["size"]; selected?: boolean; onClick?: () => void; id?: string; count?: number;
}) {
  const name = deck ?? (id ? card(id).deck : "Tokards");
  return (
    <button
      type="button"
      data-card={id}
      className={`card back ${size} ${selected ? "selected" : ""}`}
      style={{ ["--deck" as string]: deckColor(name) }}
      onClick={onClick}
      title={id ? "Carte face cachée" : undefined}
    >
      <span className="hole small-hole" />
      <span className="back-name">{name}</span>
      {count !== undefined && <span className="pile-count">{count}</span>}
    </button>
  );
}

export default function CardView(p: Props) {
  const { id, hidden, size = "m", highlight, target, selected, done, auto, onClick, badge, ghost } = p;
  if (hidden || !id) return <CardBack id={ghost ? undefined : id} deck={p.deck} size={size} selected={selected} onClick={onClick} />;
  const c = card(id);
  return (
    <button
      type="button"
      data-card={ghost ? undefined : id}
      className={`card ${size} ${c.kind === "victory" ? "victory" : ""} ${highlight ? "highlight" : ""} ${target ? "target" : ""} ${selected ? "selected" : ""} ${done ? "done" : ""}`}
      onClick={onClick}
      draggable={p.draggable}
      onDragStart={p.onDragStart}
      onDragEnd={p.onDragEnd}
      onMouseEnter={p.onHover ? (e) => p.onHover!(id, e) : undefined}
      onMouseLeave={p.onHover ? () => p.onHover!(null) : undefined}
    >
      <img src={cardImage(id)} alt="" loading="lazy" draggable={false} onError={(e) => (e.currentTarget.src = PLACEHOLDER)} />
      <span className="card-tags">{c.kind === "victory" ? "🏁" : tagIcons(c.tags)}</span>
      {badge && <span className="card-badge">{badge}</span>}
      {auto && <span className="card-auto" title="Effet automatique">⚙</span>}
      <span className="card-name">{c.name}</span>
    </button>
  );
}
