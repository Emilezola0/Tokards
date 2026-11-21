import { useEffect, useState, type DragEvent } from "react";
import KwText from "./KwText";
import { card } from "../data/cards";
import * as E from "../game/engine";
import type { GameState, Prompt, Room, TrailStep } from "../game/types";
import { ZONE_LABEL } from "../game/types";
import CardView from "./CardView";
import type { PickState } from "./PlayerBoard";
import { sfx } from "./sfx";

/** Les choix de joueurs, de cartes et de place se font directement sur la table. */
export const onTable = (p: Prompt) => p.kind === "player" || p.kind === "cards" || p.kind === "slot";

/** Carte visible sur la table (terrain, main, dessus de défausse) : on la choisit sur son plateau. */
function visibleOnTable(g: GameState, id: string) {
  const at = E.locate(g, id);
  return !!at && (at.zone === "terrain" || at.zone === "hand" || (at.zone === "discard" && at.index === 0));
}

/** État du choix sur la table + panneau de la question. */
export function useTablePick(g: GameState, prompt: Prompt | null, onAnswer: (a: unknown) => void, resetKey: string) {
  const [picked, setPicked] = useState<string[]>([]);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    setPicked([]);
    setSent(false);
  }, [resetKey]);
  if (!prompt || !onTable(prompt) || sent) return { pick: null as PickState | null, picked, setPicked, sent, answer: () => {} };
  const answer = (a: unknown) => {
    if (sent) return;
    setSent(true);
    sfx.drop();
    onAnswer(a);
  };
  const single = prompt.kind === "cards" && prompt.max === 1 && prompt.min === 1;
  const pick: PickState = {
    kind: prompt.kind as PickState["kind"],
    players: prompt.kind === "player" ? prompt.options : [],
    cards: prompt.kind === "cards" ? prompt.options : [],
    picked,
    blind: prompt.kind === "cards" ? prompt.blind : false,
    slotUid: prompt.kind === "slot" ? prompt.uid : undefined,
    slotCard: prompt.kind === "slot" ? prompt.card : undefined,
    onPlayer: (u) => answer(u),
    onCard: (id) => {
      if (prompt.kind !== "cards") return;
      sfx.pick();
      if (single) return answer([id]);
      setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < prompt.max ? [...p, id] : p));
    },
    onSlot: (i) => answer(i),
  };
  return { pick, picked, setPicked, sent, answer };
}

/** Choix déjà faits pour la même carte (même chaîne d'effets), et numéro du choix en cours. */
export function TrailInfo({ g, prompt }: { g: GameState; prompt: Prompt }) {
  const trail: TrailStep[] = g.pending?.trail ?? [];
  // Derniers choix consécutifs demandés par la même carte.
  const same: TrailStep[] = [];
  for (let i = trail.length - 1; i >= 0 && trail[i].card === (prompt.cardId ?? ""); i--) same.unshift(trail[i]);
  return (
    <div className="trail">
      <span className="trail-step">Choix n° {same.length + 1}{prompt.cardId ? ` de « ${card(prompt.cardId).name} »` : ""}</span>
      {same.length > 0 && (
        <ol className="trail-list">
          {same.map((t, i) => (
            <li key={i} title={t.text}><span className="muted">{t.text.replace(/\s*\(.*\)\s*$/, "")}</span> → <b>{t.label}</b></li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Panneau ancré en bas de la table : question, carte d'origine, validation (choix multiples). */
export function ChoiceDock({ room, g, prompt, pick, answer, onCard }: {
  room: Room; g: GameState; prompt: Prompt; pick: PickState; answer: (a: unknown) => void; onCard: (id: string) => void;
}) {
  const picked = pick.picked;
  const [hide, setHide] = useState(false);
  const hiddenOpts = prompt.kind === "cards" ? prompt.options.filter((id) => !visibleOnTable(g, id)) : [];
  const multi = prompt.kind === "cards" && !(prompt.max === 1 && prompt.min === 1);
  const hint =
    prompt.kind === "player" ? "Clique le plateau du joueur à choisir (les autres sont verrouillés)."
      : prompt.kind === "slot" ? `Clique la case où poser « ${card(prompt.card).name} » : la carte prend cette place, les suivantes se décalent.`
      : prompt.kind === "cards" && prompt.blind ? "Clique une carte face cachée."
      : "Clique une carte en surbrillance sur la table. 🔒 = ne peut pas être choisie.";
  return (
    <div className={`choice-dock panel ${hide ? "min" : ""}`}>
      {prompt.cardId && (
        <div className="dock-origin" onClick={() => onCard(prompt.cardId!)} title="Voir la carte">
          <CardView id={prompt.cardId} size="s" ghost />
        </div>
      )}
      <div className="dock-main">
        <div className="row">
          <strong className="grow dock-q">{prompt.text}</strong>
          <button className="ghost mini" onClick={() => setHide((v) => !v)}>{hide ? "▲" : "▼"}</button>
        </div>
        {!hide && (
          <>
            <TrailInfo g={g} prompt={prompt} />
            {prompt.cardId && <p className="small dock-text"><b>{card(prompt.cardId).name} :</b> <KwText text={card(prompt.cardId).text} /></p>}
            <p className="small muted">{hint}</p>
            {prompt.kind === "slot" && (
              <div className="row small"><CardView id={prompt.card} size="xs" ghost /> <span>→ terrain de <b>{E.nameOf(room, prompt.uid)}</b></span></div>
            )}
            {hiddenOpts.length > 0 && (
              <div className="dock-extra">
                <span className="small muted">Ailleurs (pioche, défausse…) :</span>
                <div className="dock-cards">
                  {hiddenOpts.map((id) => {
                    const at = E.locate(g, id);
                    return (
                      <span key={id} className="dock-card">
                        <CardView id={id} hidden={prompt.kind === "cards" && prompt.blind} size="s" ghost selected={picked.includes(id)}
                          onClick={() => pick.onCard(id)} />
                        {at && <small>{ZONE_LABEL[at.zone]} · {E.nameOf(room, at.uid)}</small>}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
            {multi && prompt.kind === "cards" && (
              <div className="row">
                <span className="small muted pick-count">
                  {prompt.max === 0 ? "Regarde les cartes puis continue." : (
                    <>
                      <span><b>{picked.length} / {prompt.max}</b> sélectionnée(s){prompt.min > 0 ? ` (au moins ${prompt.min})` : " (facultatif)"}</span>
                      <span className="pick-bar"><span style={{ width: `${(100 * picked.length) / Math.max(1, prompt.max)}%` }} /></span>
                    </>
                  )}
                </span>
                <button className="primary" disabled={picked.length < prompt.min} onClick={() => answer(picked)}>
                  {prompt.max === 0 ? "Continuer" : picked.length === 0 ? "Ne rien choisir" : "Valider"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Fenêtre de choix (options, nombre, ordre) demandée par un effet automatique. */
export default function ChoiceModal({ room, prompt, onAnswer, onCard }: {
  room: Room; prompt: Prompt; onAnswer: (a: unknown) => void; onCard: (id: string) => void;
}) {
  const g = room.game;
  const [num, setNum] = useState(prompt.kind === "number" ? prompt.min : 0);
  const [order, setOrder] = useState<string[]>(prompt.kind === "order" ? prompt.options : []);
  const [dragging, setDragging] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // Le choix peut être masqué pour regarder le plateau, puis réaffiché.
  const [hidden, setHidden] = useState(false);
  const answer = (a: unknown) => {
    if (sent) return;
    setSent(true);
    onAnswer(a);
  };

  let body: React.ReactNode = null;
  switch (prompt.kind) {
    case "option":
      body = (
        <div className="choice-grid">
          {prompt.options.map((o, i) => (
            <button key={o} className={i === 0 ? "primary" : ""} onClick={() => answer(i)}>{o}</button>
          ))}
        </div>
      );
      break;
    case "number":
      body = (
        <div className="row wrap">
          <input type="range" min={prompt.min} max={prompt.max} value={num} onChange={(e) => setNum(Number(e.target.value))} />
          <input type="number" className="num" min={prompt.min} max={prompt.max} value={num} onChange={(e) => setNum(Number(e.target.value))} />
          <button className="primary" onClick={() => answer(num)}>Valider ({num})</button>
        </div>
      );
      break;
    case "order": {
      // Glisser-déposer : la carte lâchée prend la place de celle sur laquelle on la dépose.
      const moveTo = (id: string, j: number) => {
        const o = order.filter((x) => x !== id);
        o.splice(j, 0, id);
        setOrder(o);
      };
      const moveBy = (i: number, d: number) => {
        const j = i + d;
        if (j < 0 || j >= order.length) return;
        moveTo(order[i], j);
      };
      const over = (e: DragEvent) => e.preventDefault();
      body = (
        <>
          <p className="small muted">Glisse les cartes pour changer leur ordre (ou utilise ◀ ▶). L'ordre de lecture va de gauche à droite.</p>
          <div className="order-grid">
            {order.map((id, i) => (
              <div
                key={id}
                className={`order-cell ${dragging === id ? "dragging" : ""}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", id);
                  setDragging(id);
                  sfx.pick();
                }}
                onDragEnd={() => setDragging(null)}
                onDragOver={over}
                onDragEnter={() => dragging && dragging !== id && moveTo(dragging, i)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(null);
                  sfx.drop();
                }}
              >
                <CardView id={id} size="m" ghost badge={String(i + 1)} onClick={() => onCard(id)} />
                <div className="row">
                  <button className="mini" disabled={i === 0} onClick={() => moveBy(i, -1)}>◀</button>
                  <button className="mini" disabled={i === order.length - 1} onClick={() => moveBy(i, 1)}>▶</button>
                </div>
              </div>
            ))}
          </div>
          <button className="primary" onClick={() => answer(order)}>Valider cet ordre</button>
        </>
      );
      break;
    }
  }

  if (hidden)
    return (
      <button className="primary choice-reopen" onClick={() => setHidden(false)} title="Réafficher le choix en attente">
        👁 Revenir au choix
      </button>
    );
  return (
    <div className="modal-bg choice-bg">
      <div className="modal panel choice-modal">
        <button className="choice-hide" onClick={() => setHidden(true)} title="Masquer le choix pour regarder le plateau et les cartes">
          🙈 Voir le plateau
        </button>
        <div className="choice-layout">
          {prompt.cardId && (
            <aside className="choice-origin">
              <span className="small muted">Choix demandé par</span>
              <CardView id={prompt.cardId} size="m" ghost />
              <strong>{card(prompt.cardId).name}</strong>
              <p className="small choice-origin-text"><KwText text={card(prompt.cardId).text} /></p>
            </aside>
          )}
          <div className="choice-main">
            {g && <TrailInfo g={g} prompt={prompt} />}
            <h2>{prompt.text}</h2>
            {sent ? <p className="muted">Envoi…</p> : body}
          </div>
        </div>
      </div>
    </div>
  );
}
