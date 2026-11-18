import type { DragEvent, MouseEvent } from "react";
import { PLACEHOLDER, card, cardImage, deckBack, tagIcons } from "../data/cards";
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
  store?: number;
  /** verrouillée : ne peut pas être choisie */
  locked?: boolean;
  /** désactivée : son effet et ses passifs ne fonctionnent pas */
  disabled?: boolean;
  /** cartes placées sous celle-ci */
  under?: string[];
  /** tag 🧠 ajouté jusqu'à la fin du tour */
  extraSent?: boolean;
};

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
  const { id, hidden, size = "m", highlight, target, selected, done, auto, onClick, badge, ghost, spent, store, locked, disabled, under, extraSent } = p;
  const recharged = useRecharge(!!spent);
  if (hidden || !id) return <CardBack id={ghost ? undefined : id} deck={p.deck} size={size} selected={selected} onClick={onClick} />;
  const c = card(id);
  return (
    <button
      type="button"
      data-card={ghost ? undefined : id}
      className={`card ${size} ${c.kind === "victory" ? "victory" : ""} ${highlight ? "highlight" : ""} ${target ? "target" : ""} ${selected ? "selected" : ""} ${done ? "done" : ""} ${c.trigger === "Passif" ? "passive" : ""} ${spent ? "spent" : ""} ${recharged ? "recharged" : ""} ${locked ? "locked" : ""} ${disabled ? "disabled" : ""} ${under?.length ? "has-under" : ""}`}
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
      <span className="card-name">{c.name}</span>
      {spent && <span className="card-spent" title="Effet déjà joué : se recharge au prochain tour de son joueur">✓</span>}
      {!!store && <span className="card-store" title="Gold stockés sur cette carte">💰 {store}</span>}
      {locked && <span className="card-lock">🔒</span>}
      {disabled && <span className="card-disabled" title="Désactivée : son effet et ses passifs ne fonctionnent pas">⛔</span>}
      {!!under?.length && (
        <span className="card-under" title={`Dessous : ${under.map((u) => card(u).name).join(", ")}`}>
          ⤵ {under.length}
        </span>
      )}
    </button>
  );
}
