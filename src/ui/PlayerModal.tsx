import { useState } from "react";
import * as E from "../game/engine";
import { kickPlayer } from "../game/room";
import type { GameState, Room } from "../game/types";
import { BH_SYMBOL, BLACK_HOLES, WEATHERS, showWeather, weatherLabel } from "../game/types";
import CardView from "./CardView";

type Run = (fn: (r: Room, g: GameState) => void) => void;

export default function PlayerModal({ owner, room, uid, run, onCard, onClose }: {
  owner: string; room: Room; uid: string; run: Run; onCard: (id: string) => void; onClose: () => void;
}) {
  const g = room.game!;
  const p = g.players[owner];
  const isPlayer = !!g.players[uid];
  const canEdit = isPlayer && E.currentPlayer(g) === uid && !g.pending;
  const [amount, setAmount] = useState(10);
  const [to, setTo] = useState(g.order.find((u) => u !== owner) ?? owner);
  const n = Math.max(0, Math.trunc(amount) || 0);
  const name = E.nameOf(room, owner);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal panel player-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{name}{owner === uid && " (toi)"}</h2>

        {!canEdit && <p className="small muted">Outils manuels réservés au joueur dont c'est le tour.</p>}
        <fieldset disabled={!canEdit}>
          <h3>💰 Gold : {p.gold}</h3>
          <div className="row wrap">
            <input type="number" min={0} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="num" />
            <button onClick={() => run((r, gg) => E.changeGold(r, gg, owner, n))}>Gagner +{n}</button>
            <button onClick={() => run((r, gg) => E.changeGold(r, gg, owner, -n))}>Perdre −{n}</button>
            <span>donner à</span>
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              {g.order.filter((u) => u !== owner).map((u) => <option key={u} value={u}>{E.nameOf(room, u)}</option>)}
            </select>
            <button disabled={to === owner} onClick={() => run((r, gg) => E.transferGold(r, gg, owner, to, n))}>Donner</button>
          </div>
          <label className="check small">
            <input type="checkbox" checked={p.allowNegativeGold} onChange={(e) => run((r, gg) => {
              gg.players[owner].allowNegativeGold = e.target.checked;
              E.log(gg, `${E.nameOf(r, owner)} : gold négatifs ${e.target.checked ? "autorisés" : "interdits"}.`);
            })} />
            Gold négatifs autorisés (effet de carte)
          </label>

          <h3>🧠 Sentience : {p.sentience ? "Vraie" : "Fausse"}</h3>
          <div className="row">
            <button className={p.sentience ? "primary" : ""} onClick={() => run((r, gg) => E.setSentience(r, gg, owner, true))}>Vraie</button>
            <button className={!p.sentience ? "primary" : ""} onClick={() => run((r, gg) => E.setSentience(r, gg, owner, false))}>Fausse</button>
            <button onClick={() => run((r, gg) => E.setSentience(r, gg, owner, !gg.players[owner].sentience))}>Inverser</button>
          </div>

          <h3>🌀 Trou noir</h3>
          <div className="row wrap">
            {BLACK_HOLES.map((b) => (
              <button key={b.id} className={p.blackHole === b.id ? "primary" : ""} onClick={() => run((r, gg) => E.setBlackHole(r, gg, owner, b.id))}>
                {BH_SYMBOL[b.id]} {b.id}
              </button>
            ))}
          </div>

          {showWeather() && (
            <>
              <h3>🌦️ Météo : {weatherLabel(E.weatherOf(g, owner))}</h3>
              <div className="row wrap">
                {[null, ...WEATHERS.filter((w) => w.id !== "Orage")].map((w) => (
                  <button key={w?.id ?? "clear"} className={(p.weather ?? null) === (w?.id ?? null) ? "primary" : ""} onClick={() => run((r, gg) => {
                    gg.players[owner].weather = w?.id ?? null;
                    E.log(gg, `${E.nameOf(r, owner)} : météo ${weatherLabel(w?.id ?? null)}.`);
                  })}>
                    {w?.icon ?? "🌤️"} {weatherLabel(w?.id ?? null)}
                  </button>
                ))}
              </div>
            </>
          )}

          <h3>Cartes</h3>
          <div className="row wrap">
            <button onClick={() => run((r, gg) => {
              const k = E.drawCards(gg, owner, 1);
              E.log(gg, `${E.nameOf(r, owner)} pioche ${k} carte.`);
            })}>{owner === uid ? "Piocher 1 carte" : `Faire piocher 1 carte à ${name}`}</button>
            {owner !== uid && (
              <>
                <button onClick={() => run((r, gg) => {
                  const k = E.drawCards(gg, uid, 1, owner);
                  E.log(gg, `${E.nameOf(r, uid)} pioche ${k} carte dans la pioche de ${E.nameOf(r, owner)}.`);
                })}>Piocher dans sa pioche</button>
                <button disabled={!p.hand.length} onClick={() => run((r, gg) => E.takeRandomFromHand(r, gg, owner, uid))}>Prendre une carte au hasard de sa main</button>
              </>
            )}
            <button onClick={() => run((r, gg) => E.shuffleDeck(r, gg, owner, false))}>Mélanger la pioche</button>
            <button onClick={() => run((r, gg) => E.shuffleDeck(r, gg, owner, true))}>Défausse + pioche → mélanger</button>
          </div>
        </fieldset>

        <h3>Défausse ({p.discard.length}) <span className="small muted">— la 1re est le dessus</span></h3>
        <div className="discard-list">
          {p.discard.map((id) => <CardView key={id} id={id} size="s" onClick={() => onCard(id)} />)}
          {!p.discard.length && <span className="muted small">Vide</span>}
        </div>
        <div className="row">
          {room.hostUid === uid && owner !== uid && !p.out && (
            <button
              className="ghost danger"
              title="Le joueur est mis hors jeu (ses tours sont passés) et ne peut plus revenir"
              onClick={() => {
                if (!confirm(`Exclure ${name} de la partie ? Ses tours seront passés et il ne pourra plus revenir.`)) return;
                kickPlayer(room.code, uid, owner).catch((e) => alert((e as Error).message));
                onClose();
              }}
            >
              🚫 Exclure {name}
            </button>
          )}
          <span className="grow" />
          <button className="ghost" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
