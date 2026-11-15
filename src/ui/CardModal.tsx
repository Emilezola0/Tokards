import { useState } from "react";
import { PLACEHOLDER, card, cardImage, tagIcons } from "../data/cards";
import * as E from "../game/engine";
import type { GameState, Room } from "../game/types";
import { ZONE_LABEL } from "../game/types";
import { isAutomated } from "../effects/runtime";

export type Placing = { id: string; from: "hand" | "terrain" | "discard" };
type Run = (fn: (r: Room, g: GameState) => void) => void;

export default function CardModal({ id, room, uid, run, onPlace, onClose }: {
  id: string; room: Room; uid: string; run: Run; onPlace: (p: Placing) => void; onClose: () => void;
}) {
  const g = room.game!;
  const c = card(id);
  const at = E.locate(g, id);
  const isPlayer = !!g.players[uid];
  const myTurn = isPlayer && E.currentPlayer(g) === uid && !g.pending;
  const owner = g.owner[id];
  const [giveTo, setGiveTo] = useState(g.order.find((u) => u !== uid) ?? uid);
  const doRun = (fn: (r: Room, g: GameState) => void) => {
    run(fn);
    onClose();
  };
  const move = (dest: E.Dest) => doRun((r, gg) => E.moveCard(r, gg, id, dest));
  const players = g.order;
  const playerSelect = (
    <select value={giveTo} onChange={(e) => setGiveTo(e.target.value)}>
      {players.map((u) => <option key={u} value={u}>{E.nameOf(room, u)}</option>)}
    </select>
  );

  let actions: React.ReactNode = null;
  if (c.kind === "victory") {
    const holder = g.order.find((u) => g.players[u].personalVC === id);
    actions = holder ? (
      <label className="check">
        <input type="checkbox" checked={g.players[holder].personalDone} disabled={!isPlayer} onChange={(e) => run((r, gg) => E.setPersonalDone(r, gg, holder, e.target.checked))} />
        Condition de {E.nameOf(room, holder)} remplie
      </label>
    ) : g.commonVC === id ? (
      <>
        <span className="small muted">Condition commune remplie par :</span>
        {[...new Set(g.order.map((u) => E.teamKey(room, u)))].map((t) => (
          <label key={t} className="check">
            <input type="checkbox" checked={g.commonDone.includes(t)} disabled={!isPlayer} onChange={(e) => run((r, gg) => E.setCommonDone(r, gg, t, e.target.checked))} />
            {E.teamLabel(room, t)}
          </label>
        ))}
      </>
    ) : null;
  } else if (myTurn && at) {
    if (at.zone === "hand" && at.uid === uid) {
      actions = (
        <>
          <button className="primary" disabled={g.phase !== "action"} onClick={() => onPlace({ id, from: "hand" })}>Poser sur mon terrain…</button>
          <button disabled={g.phase !== "action"} onClick={() => doRun((r, gg) => E.discardFromHand(r, gg, uid, id))}>Défausser (action du tour)</button>
          <span className="small muted">Outils manuels :</span>
          <button onClick={() => move({ uid: owner ?? uid, zone: "deck" })}>Remettre sur la pioche</button>
          <button onClick={() => move({ uid: owner ?? uid, zone: "deck", bottom: true })}>Au fond de la pioche</button>
          <div className="row">Donner à {playerSelect}<button onClick={() => move({ uid: giveTo, zone: "hand" })}>Donner</button></div>
        </>
      );
    } else if (at.zone === "terrain") {
      actions = (
        <>
          <button onClick={() => doRun((r, gg) => E.log(gg, `${E.nameOf(r, uid)} active « ${c.name} » (terrain de ${E.nameOf(r, at.uid)}).`))}>
            Activer l'effet (journal)
          </button>
          <button onClick={() => onPlace({ id, from: "terrain" })}>Déplacer…</button>
          <button onClick={() => move({ uid: owner ?? at.uid, zone: "discard" })}>Défausser (chez {E.nameOf(room, owner ?? at.uid)})</button>
          <button onClick={() => move({ uid: owner ?? at.uid, zone: "deck", bottom: true })}>Au fond de la pioche</button>
          <button onClick={() => move({ uid: owner ?? at.uid, zone: "deck" })}>Sur la pioche</button>
          <div className="row">Dans la main de {playerSelect}<button onClick={() => move({ uid: giveTo, zone: "hand" })}>OK</button></div>
        </>
      );
    } else if (at.zone === "discard") {
      actions = (
        <>
          <button className="primary" onClick={() => move({ uid, zone: "hand" })}>Prendre dans ma main</button>
          <button onClick={() => onPlace({ id, from: "discard" })}>Poser sur un terrain…</button>
          <button onClick={() => move({ uid: at.uid, zone: "deck" })}>Sur la pioche</button>
          <button onClick={() => move({ uid: at.uid, zone: "deck", bottom: true })}>Au fond de la pioche</button>
        </>
      );
    }
  }

  const hiddenCard = at && ((at.zone === "hand" && at.uid !== uid) || at.zone === "deck");
  if (hiddenCard) return null;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal panel card-modal" onClick={(e) => e.stopPropagation()}>
        <img src={cardImage(id)} alt="" onError={(e) => (e.currentTarget.src = PLACEHOLDER)} />
        <div className="card-detail">
          <h2>{c.name}</h2>
          <p className="muted small">
            {c.kind === "victory" ? "🏁 Condition de victoire" : tagIcons(c.tags)} · {c.deck}
            {at && ` · ${ZONE_LABEL[at.zone]} de ${E.nameOf(room, at.uid)}`}
            {owner && at && owner !== at.uid && ` (appartient à ${E.nameOf(room, owner)})`}
          </p>
          <p className="small">
            {c.trigger && <span className="badge">{c.trigger}</span>}
            {c.event && `${c.event} `}
            {c.kind === "card" && (room.auto !== false && isAutomated(id)
              ? <span className="badge auto-badge">⚙ Effet automatique</span>
              : <span className="badge">✋ Effet manuel</span>)}
          </p>
          <p className="card-text">{c.text}</p>
          {c.rules && <p className="small rules"><b>Précisions :</b> {c.rules}</p>}
          <div className="card-actions">{actions}</div>
          {!myTurn && isPlayer && c.kind === "card" && <p className="small muted">Seul le joueur dont c'est le tour peut agir.</p>}
          <button className="ghost" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
