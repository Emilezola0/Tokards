import { Fragment } from "react";
import { DECKS, card, tagIcons } from "../data/cards";
import CardView from "./CardView";
import { sfx } from "./sfx";

/** Toutes les cartes d'un deck, en grille (en partie et dans le salon). */
export function DeckModal({ deck, onCard, onClose }: { deck: string; onCard?: (id: string) => void; onClose: () => void }) {
  const d = DECKS.find((x) => x.name === deck);
  if (!d) return null;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal panel viewer" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 className="grow">🂠 {d.name} <span className="muted small">{d.cards.length} cartes</span></h2>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>
        {d.description && <p className="small muted">{d.description}</p>}
        <div className="viewer-grid">
          {d.cards.map((id) => (
            <CardView key={id} id={id} size="m" ghost onClick={onCard ? () => onCard(id) : undefined} />
          ))}
        </div>
        {d.vcs.length > 0 && (
          <>
            <h3>Conditions de victoire du deck</h3>
            <div className="viewer-grid">
              {d.vcs.map((id) => <CardView key={id} id={id} size="m" ghost onClick={onCard ? () => onCard(id) : undefined} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Les effets d'un terrain dans l'ordre d'activation, reliés par des flèches. */
export function TerrainModal({ name, terrain, onCard, onClose }: { name: string; terrain: string[]; onCard?: (id: string) => void; onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal panel viewer" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 className="grow">📜 Terrain de {name}</h2>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>
        <p className="small muted">Ordre d'activation (sens de lecture) pendant la phase 1.</p>
        <div className="chain">
          {terrain.map((id, i) => {
            const c = card(id);
            return (
              <Fragment key={id}>
                {i > 0 && <span className="chain-arrow">➜</span>}
                <div
                  className={`chain-step ${c.trigger === "Passif" ? "passive" : ""}`}
                  onClick={() => {
                    sfx.click();
                    onCard?.(id);
                  }}
                >
                  <span className="chain-num">{i + 1}</span>
                  <CardView id={id} size="s" ghost />
                  <div className="chain-text">
                    <strong>{c.name}</strong> <span>{tagIcons(c.tags)}</span>
                    {c.trigger === "Passif" && <span className="badge passive-badge">✨ Passif · {c.event}</span>}
                    <p className="small">{c.text}</p>
                  </div>
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
