import { useState } from "react";
import { card } from "../data/cards";
import * as E from "../game/engine";
import type { Prompt, Room } from "../game/types";
import CardView from "./CardView";

/** Fenêtre de choix demandée par un effet automatique. */
export default function ChoiceModal({ room, prompt, onAnswer, onCard }: {
  room: Room; prompt: Prompt; onAnswer: (a: unknown) => void; onCard: (id: string) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [num, setNum] = useState(prompt.kind === "number" ? prompt.min : 0);
  const [order, setOrder] = useState<string[]>(prompt.kind === "order" ? prompt.options : []);
  const [sent, setSent] = useState(false);
  const answer = (a: unknown) => {
    if (sent) return;
    setSent(true);
    onAnswer(a);
  };

  let body: React.ReactNode = null;
  switch (prompt.kind) {
    case "player":
      body = (
        <div className="choice-grid">
          {prompt.options.map((u) => (
            <button key={u} className="choice-player" onClick={() => answer(u)}>
              <strong>{E.nameOf(room, u)}</strong>
              {room.game && (
                <span className="small muted">
                  💰 {room.game.players[u].gold} · 🧠 {room.game.players[u].sentience ? "V" : "F"} · 🌀 {room.game.players[u].blackHole} · {room.game.players[u].terrain.length} carte(s)
                </span>
              )}
            </button>
          ))}
        </div>
      );
      break;
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
    case "cards": {
      const single = prompt.max === 1 && prompt.min === 1;
      const toggle = (id: string) => {
        if (single) return answer([id]);
        setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < prompt.max ? [...p, id] : p));
      };
      body = (
        <>
          <div className="choice-cards">
            {prompt.options.map((id, i) => (
              <div key={id} className="choice-card">
                <CardView id={id} hidden={prompt.blind} size="m" selected={picked.includes(id)} badge={prompt.blind ? String(i + 1) : undefined} onClick={() => toggle(id)} />
                {!prompt.blind && <button className="ghost small" onClick={() => onCard(id)}>Détails</button>}
              </div>
            ))}
          </div>
          {!single && (
            <div className="row">
              <span className="small muted">{picked.length} sélectionnée(s) — min {prompt.min}, max {prompt.max}</span>
              <button className="primary" disabled={picked.length < prompt.min} onClick={() => answer(picked)}>Valider</button>
            </div>
          )}
        </>
      );
      break;
    }
    case "order": {
      const moveBy = (i: number, d: number) => {
        const j = i + d;
        if (j < 0 || j >= order.length) return;
        const o = [...order];
        [o[i], o[j]] = [o[j], o[i]];
        setOrder(o);
      };
      body = (
        <>
          <div className="choice-cards">
            {order.map((id, i) => (
              <div key={id} className="choice-card">
                <CardView id={id} size="m" badge={String(i + 1)} onClick={() => onCard(id)} />
                <div className="row">
                  <button disabled={i === 0} onClick={() => moveBy(i, -1)}>◀</button>
                  <button disabled={i === order.length - 1} onClick={() => moveBy(i, 1)}>▶</button>
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

  return (
    <div className="modal-bg choice-bg">
      <div className="modal panel choice-modal">
        {prompt.cardId && <div className="choice-source small muted">✨ {card(prompt.cardId).name}</div>}
        <h2>{prompt.text}</h2>
        {sent ? <p className="muted">Envoi…</p> : body}
      </div>
    </div>
  );
}
