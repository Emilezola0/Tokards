import { Fragment, useState } from "react";
import { DECKS, PLACEHOLDER, card, cardImage, tagIcons } from "../data/cards";
import { isAutomated } from "../effects/runtime";
import CardView from "./CardView";
import { sfx } from "./sfx";

/** Détail d'une carte (image, tags, déclenchement, texte, précisions). */
export function CardDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const c = card(id);
  return (
    <div className="card-detail-view">
      <img src={cardImage(id)} alt="" onError={(e) => (e.currentTarget.src = PLACEHOLDER)} />
      <div className="card-detail">
        <h2>{c.name}</h2>
        <p className="muted small">{c.kind === "victory" ? "🏁 Condition de victoire" : tagIcons(c.tags)} · {c.deck}</p>
        <p className="small">
          {c.trigger && <span className="badge">{c.trigger}</span>} {c.event}
          {c.kind === "card" && (isAutomated(id) ? <span className="badge auto-badge">⚙ Effet automatique</span> : <span className="badge">✋ Effet manuel</span>)}
        </p>
        <p className="card-text">{c.text}</p>
        {c.rules && <p className="small rules"><b>Précisions :</b> {c.rules}</p>}
        <button className="ghost" onClick={onBack}>← Retour au deck</button>
      </div>
    </div>
  );
}

/** Toutes les cartes d'un deck, en grille (en partie et dans le salon). Clic = détail de la carte. */
export function DeckModal({ deck, onClose }: { deck: string; onClose: () => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const d = DECKS.find((x) => x.name === deck);
  if (!d) return null;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal panel viewer" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 className="grow">🂠 {d.name} <span className="muted small">{d.cards.length} cartes</span></h2>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>
        {sel ? (
          <CardDetail id={sel} onBack={() => setSel(null)} />
        ) : (
          <>
            {d.description && <p className="small muted">{d.description}</p>}
            <p className="small muted">Clique une carte pour voir son effet en détail.</p>
            <div className="viewer-grid">
              {d.cards.map((id) => <CardView key={id} id={id} size="m" ghost auto={isAutomated(id)} onClick={() => setSel(id)} />)}
            </div>
            {d.vcs.length > 0 && (
              <>
                <h3>Conditions de victoire du deck</h3>
                <div className="viewer-grid">
                  {d.vcs.map((id) => <CardView key={id} id={id} size="m" ghost onClick={() => setSel(id)} />)}
                </div>
              </>
            )}
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
