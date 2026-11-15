import { useState } from "react";
import { card, cardImage, tagIcons } from "../data/cards";
import * as E from "../game/engine";
import type { GameState, Room } from "../game/types";
import { ZONE_LABEL } from "../game/types";

export type Placing = { id: string; from: "hand" | "terrain" | "discard" };
type Run = (fn: (r: Room, g: GameState) => void) => void;

export default function CardModal({ id, room, uid, run, onPlace, onClose }: {
  id: string; room: Room; uid: string; run: Run; onPlace: (p: Placing) => void; onClose: () => void;
}) {
  const g = room.game!;
  const c = card(id);
  const at = E.locate(g, id);
  const isPlayer = !!g.players[uid];
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
  if (isPlayer && at) {
    if (at.zone === "hand" && at.uid === uid) {
      actions = (
        <>
          <button className="primary" onClick={() => onPlace({ id, from: "hand" })}>Poser sur un terrain…</button>
          <button onClick={() => doRun((r, gg) => E.discardFromHand(r, gg, uid, id))}>Défausser</button>
          <button onClick={() => move({ uid: owner ?? uid, zone: "deck" })}>Remettre sur la pioche</button>
          <button onClick={() => move({ uid: owner ?? uid, zone: "deck", bottom: true })}>Au fond de la pioche</button>
          <div className="row">Donner à {playerSelect}<button onClick={() => move({ uid: giveTo, zone: "hand" })}>Donner</button></div>
        </>
      );
    } else if (at.zone === "terrain") {
      actions = (
        <>
          <button className="primary" onClick={() => doRun((r, gg) => E.log(gg, `${E.nameOf(r, uid)} active « ${c.name} » (terrain de ${E.nameOf(r, at.uid)}).`))}>
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

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal panel card-modal" onClick={(e) => e.stopPropagation()}>
        <img src={cardImage(id)} alt="" onError={(e) => (e.currentTarget.src = "/cards/placeholder.svg")} />
        <div className="card-detail">
          <h2>{c.name}</h2>
          <p className="muted small">
            {c.kind === "victory" ? "🏁 Condition de victoire" : tagIcons(c.tags)} · {c.deck}
            {at && ` · ${ZONE_LABEL[at.zone]} de ${E.nameOf(room, at.uid)}`}
            {owner && at && owner !== at.uid && ` (appartient à ${E.nameOf(room, owner)})`}
          </p>
          {c.trigger && <p className="small"><span className="badge">{c.trigger}</span>{c.event && ` ${c.event}`}</p>}
          <p className="card-text">{c.text}</p>
          <div className="card-actions">{actions}</div>
          <button className="ghost" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
