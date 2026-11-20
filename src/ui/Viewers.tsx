import { Fragment, useEffect, useState } from "react";
import KwText from "./KwText";
import { BASE_VCS, DECKS, PLACEHOLDER, card, cardImage, deckBack, tagIcons } from "../data/cards";
import { isAutomated } from "../effects/runtime";
import CardView from "./CardView";
import { sfx } from "./sfx";
import VoiceButton, { VoiceVolume } from "./VoiceButton";
import { hasVoice, playDeckVoice } from "./voice";

/** Détail d'une carte (image, tags, déclenchement, texte, précisions). */
export function CardDetail({ id, onBack, backLabel = "← Retour au deck" }: { id: string; onBack: () => void; backLabel?: string }) {
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
        <p className="card-text"><KwText text={c.text} /></p>
        {c.rules && <p className="small rules"><b>Précisions :</b> {c.rules}</p>}
        <VoiceButton id={id} />
        <button className="ghost" onClick={onBack}>{backLabel}</button>
      </div>
    </div>
  );
}

/** Détail d'une carte par-dessus la fenêtre en cours (le deck reste derrière, on y revient en fermant). */
function DetailOver({ id, list, onSelect, onClose, backLabel }: {
  id: string; list: string[]; onSelect: (id: string) => void; onClose: () => void; backLabel: string;
}) {
  const i = list.indexOf(id);
  const prev = i > 0 ? list[i - 1] : null;
  const next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  const go = (c: string | null) => c && (sfx.click(), onSelect(c));
  // Flèches du clavier : carte précédente / suivante ; Échap : retour.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && prev) (e.stopPropagation(), go(prev));
      else if (e.key === "ArrowRight" && next) (e.stopPropagation(), go(next));
      else if (e.key === "Escape") (e.stopPropagation(), onClose());
    };
    addEventListener("keydown", k, true);
    return () => removeEventListener("keydown", k, true);
  });
  return (
    <div className="modal-bg over" onClick={(e) => (e.stopPropagation(), onClose())}>
      <button className="detail-nav prev" disabled={!prev} title={prev ? `← ${card(prev).name}` : undefined} aria-label="Carte précédente" onClick={(e) => (e.stopPropagation(), go(prev))}>‹</button>
      <div key={id} className="modal panel viewer detail-over" onClick={(e) => e.stopPropagation()}>
        <CardDetail id={id} onBack={onClose} backLabel={backLabel} />
        {i >= 0 && <p className="small muted detail-count">{i + 1} / {list.length} · flèches ← → pour naviguer</p>}
      </div>
      <button className="detail-nav next" disabled={!next} title={next ? `${card(next).name} →` : undefined} aria-label="Carte suivante" onClick={(e) => (e.stopPropagation(), go(next))}>›</button>
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
        <section className="vw-sec vw-sec-info">
          <h3 className="vw-title">📖 Présentation</h3>
          <div className="deck-head">
            {deckBack(d.name) && <img className="deck-back-img" src={deckBack(d.name)!} alt="" />}
            <div>
              {!!d.keywords?.length && <div className="deck-kw big">{d.keywords.map((k) => <i key={k}>{k}</i>)}</div>}
              {d.summary && <p className="deck-summary">{d.summary}</p>}
              {d.description && <p className="small muted">{d.description}</p>}
              {d.difficulty && <p className="small">Difficulté : <b>{d.difficulty}</b></p>}
              {d.cards.some(hasVoice) && <VoiceVolume k={`deck:${d.name}`} label="Volume des voicelines du deck" sample={() => playDeckVoice(d.name)} />}
            </div>
          </div>
        </section>
        <section className="vw-sec vw-sec-cards">
          <h3 className="vw-title">🃏 Cartes <i>{d.cards.length}</i></h3>
          <p className="small muted">Clique une carte pour voir son effet en détail.</p>
          <div className="viewer-grid">
            {d.cards.map((id) => <CardView key={id} id={id} size="m" ghost auto={isAutomated(id)} onClick={() => setSel(id)} />)}
          </div>
        </section>
        {d.vcs.length > 0 && (
          <section className="vw-sec vw-sec-vc">
            <h3 className="vw-title">🏁 Conditions de victoire du deck <i>{d.vcs.length}</i></h3>
            <div className="viewer-grid">
              {d.vcs.map((id) => <CardView key={id} id={id} size="m" ghost onClick={() => setSel(id)} />)}
            </div>
          </section>
        )}
      </div>
      {sel && <DetailOver id={sel} list={[...d.cards, ...d.vcs]} onSelect={setSel} onClose={() => setSel(null)} backLabel="← Retour au deck" />}
    </div>
  );
}

/** Toutes les conditions de victoire : les communes, puis celles de chaque deck. Clic = détail. */
export function VictoryModal({ decks, onClose }: { decks: string[]; onClose: () => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const groups = [
    { name: "Conditions de base", sub: "toujours dans la pioche", ids: BASE_VCS },
    ...decks.map((n) => DECKS.find((d) => d.name === n)).filter((d) => d && d.vcs.length).map((d) => ({ name: d!.name, sub: "ajoutées quand ce deck est en jeu", ids: d!.vcs })),
  ];
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal panel viewer" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 className="grow">🏁 Conditions de victoire</h2>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>
        <p className="small muted">En début de partie, une condition commune est tirée pour toute la table, puis chaque joueur reçoit une condition personnelle. Elles sont tirées parmi les conditions de base et celles des decks en jeu. Clique une carte pour voir le détail.</p>
        {groups.map((gr, i) => (
          <section key={gr.name} className={`vw-sec vc-group ${i === 0 ? "vw-sec-base" : "vw-sec-vc"}`}>
            <h3 className="vw-title">{i === 0 ? "⭐" : "🂠"} {gr.name} <i>{gr.ids.length}</i></h3>
            <p className="small muted vw-sub">{gr.sub}</p>
            <div className="vc-list">
              {gr.ids.map((id) => (
                <div key={id} className="vc-item" onClick={() => setSel(id)}>
                  <CardView id={id} size="s" ghost />
                  <div>
                    <strong>{card(id).name}</strong>
                    <p className="small"><KwText text={card(id).text} /></p>
                    {card(id).rules && <p className="small muted">{card(id).rules}</p>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      {sel && <DetailOver id={sel} list={groups.flatMap((gr) => gr.ids)} onSelect={setSel} onClose={() => setSel(null)} backLabel="← Retour aux conditions" />}
    </div>
  );
}

/** Cartes sorties de la partie (elles ne sont plus dans aucune zone). */
export function GoneModal({ ids, ownerName, onCard, onClose }: { ids: string[]; ownerName: (id: string) => string; onCard: (id: string) => void; onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal panel viewer" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 className="grow">🕳 Cartes disparues <span className="muted small">{ids.length}</span></h2>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>
        <p className="small muted">Ces cartes ont quitté la partie : elles ne sont plus dans aucune pioche, main, défausse ou terrain. Clique une carte pour voir son effet.</p>
        <div className="viewer-grid">
          {ids.map((id) => (
            <div key={id} className="gone-item">
              <CardView id={id} size="m" ghost onClick={() => onCard(id)} />
              <span className="small muted">à {ownerName(id)}</span>
            </div>
          ))}
        </div>
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
                    <p className="small"><KwText text={c.text} /></p>
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
