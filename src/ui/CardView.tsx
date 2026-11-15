import { PLACEHOLDER, card, cardImage, tagIcons } from "../data/cards";

type Props = {
  id?: string;
  hidden?: boolean;
  size?: "s" | "m" | "l";
  highlight?: boolean;
  selected?: boolean;
  done?: boolean;
  /** effet automatique en mode auto */
  auto?: boolean;
  onClick?: () => void;
  badge?: string;
};

export default function CardView({ id, hidden, size = "m", highlight, selected, done, auto, onClick, badge }: Props) {
  if (hidden || !id)
    return (
      <button type="button" className={`card back ${size} ${selected ? "selected" : ""}`} onClick={onClick}>
        <span className="hole small-hole" />
      </button>
    );
  const c = card(id);
  return (
    <button
      type="button"
      data-card={id}
      className={`card ${size} ${c.kind === "victory" ? "victory" : ""} ${highlight ? "highlight" : ""} ${selected ? "selected" : ""} ${done ? "done" : ""}`}
      onClick={onClick}
      title={`${c.name}\n\n${c.text}`}
    >
      <img src={cardImage(id)} alt="" loading="lazy" onError={(e) => (e.currentTarget.src = PLACEHOLDER)} />
      <span className="card-tags">{c.kind === "victory" ? "🏁" : tagIcons(c.tags)}</span>
      {badge && <span className="card-badge">{badge}</span>}
      {auto && <span className="card-auto" title="Effet automatique">⚙</span>}
      <span className="card-name">{c.name}</span>
    </button>
  );
}
