import { PLACEHOLDER, card, cardImage, tagIcons } from "../data/cards";

type Props = {
  id?: string;
  hidden?: boolean;
  size?: "s" | "m" | "l";
  highlight?: boolean;
  selected?: boolean;
  done?: boolean;
  onClick?: () => void;
  badge?: string;
};

export default function CardView({ id, hidden, size = "m", highlight, selected, done, onClick, badge }: Props) {
  if (hidden || !id)
    return (
      <div className={`card back ${size}`} onClick={onClick}>
        <span className="hole small-hole" />
      </div>
    );
  const c = card(id);
  return (
    <button
      type="button"
      className={`card ${size} ${c.kind === "victory" ? "victory" : ""} ${highlight ? "highlight" : ""} ${selected ? "selected" : ""} ${done ? "done" : ""}`}
      onClick={onClick}
      title={`${c.name}\n\n${c.text}`}
    >
      <img src={cardImage(id)} alt="" loading="lazy" onError={(e) => (e.currentTarget.src = PLACEHOLDER)} />
      <span className="card-tags">{c.kind === "victory" ? "🏁" : tagIcons(c.tags)}</span>
      {badge && <span className="card-badge">{badge}</span>}
      <span className="card-name">{c.name}</span>
    </button>
  );
}
