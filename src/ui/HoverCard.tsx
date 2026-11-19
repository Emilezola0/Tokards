import { PLACEHOLDER, card, cardImage, tagIcons } from "../data/cards";
import KwText from "./KwText";
import type { Preview } from "../effects/runtime";

/** Fiche agrandie d'une carte au survol, avec l'aperçu de son effet. */
export default function HoverCard({ id, x, y, preview, auto, nameOf, me, noPlay }: {
  id: string; x: number; y: number; preview: Preview | null; auto: boolean; nameOf?: (uid: string) => string; me?: string; noPlay?: string | null;
}) {
  const c = card(id);
  const W = 300;
  const left = x + 24 + W > innerWidth ? Math.max(8, x - 24 - W) : x + 24;
  const top = Math.max(8, Math.min(y - 120, innerHeight - 380));
  const impossible = preview && !preview.ok;
  return (
    <div className="hover-card panel" style={{ left, top, width: W }}>
      <div className="hover-head">
        <img src={cardImage(id)} alt="" onError={(e) => (e.currentTarget.src = PLACEHOLDER)} />
        <div>
          <strong>{c.name}</strong>
          <div className="small muted">{c.kind === "victory" ? "🏁 Condition de victoire" : `${tagIcons(c.tags) || "—"} · ${c.deck}`}</div>
          {c.trigger && <div className="small"><span className="badge">{c.trigger}</span>{c.event}</div>}
          {c.kind === "card" && auto && preview && <div className="small auto-note">⚙ Effet automatique</div>}
        </div>
      </div>
      <p className={`hover-text ${impossible ? "dim" : ""}`} title={impossible ? preview!.reason : undefined}><KwText text={c.text} /></p>
      {noPlay && <p className="hover-reason">🚫 Tu ne peux pas la poser : {noPlay}</p>}
      {impossible && <p className="hover-reason">✖ Impossible maintenant : {preview!.reason}</p>}
      {preview?.ok && !!preview.summary?.length && nameOf && (
        <div className="hover-sum">
          <span className="small muted">{preview.uncertain ? "Si tu l'actives (exemple, selon les choix et les dés) :" : "Si tu l'actives :"}</span>
          {preview.summary.map((r) => (
            <span key={r.uid} className="hover-sum-row">
              <b>{r.uid === me ? "Toi" : nameOf(r.uid)}</b>
              {r.gold !== 0 && <span className={r.gold > 0 ? "up" : "down"}>{r.gold > 0 ? "+" : "−"}{Math.abs(r.gold)} 💰</span>}
              {r.sent !== undefined && <span className={r.sent ? "up" : "down"}>🧠 {r.sent ? "vraie" : "fausse"}</span>}
              {r.bh && <span className="bh">🌀 {r.bh}</span>}
            </span>
          ))}
        </div>
      )}
      {preview?.ok && (preview.cards.length + preview.gold.length + preview.sentience.length + preview.bh.length + preview.players.length > 0) && (
        <p className="small hover-hint">Les éléments touchés sont surlignés sur la table.</p>
      )}
      {c.rules && <p className="small rules">{c.rules.replace(" [Automatisée]", "").replace("[Automatisée]", "")}</p>}
    </div>
  );
}
