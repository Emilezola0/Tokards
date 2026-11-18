import { useState } from "react";
import KwText from "./KwText";
import { PLACEHOLDER, card, cardImage, tagIcons } from "../data/cards";
import * as E from "../game/engine";
import type { GameState, Room, Until } from "../game/types";
import { ZONE_LABEL } from "../game/types";
import { isAutomated, noPlayReason } from "../effects/runtime";
import { isAutoVC, lettersOf, teamProgress, vcProgress, wordFits } from "../game/victory";
import { Gauge } from "./PlayerBoard";

export type Placing = { id: string; from: "hand" | "terrain" | "discard" };
type Run = (fn: (r: Room, g: GameState) => void) => void;

export default function CardModal({ id, room, uid, run, onPlace, onClose, onClaimWord, onDiscard }: {
  id: string; room: Room; uid: string; run: Run; onPlace: (p: Placing) => void; onClose: () => void;
  onClaimWord?: (word: string) => void; onDiscard?: (id: string) => void;
}) {
  const g = room.game!;
  const c = card(id);
  const at = E.locate(g, id);
  const isPlayer = !!g.players[uid];
  const myTurn = isPlayer && E.currentPlayer(g) === uid && !g.pending;
  const owner = g.owner[id];
  const [word, setWord] = useState("");
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
    const autoVC = room.auto !== false && isAutoVC(id);
    const line = (label: string, done: boolean, prog: ReturnType<typeof vcProgress>) => (
      <div className="vc-prog">
        <span className="row"><b className="grow">{label}</b>{done ? "✔ Remplie" : prog ? `${Math.round(prog.ratio * 100)} %` : ""}</span>
        {prog && !done && <Gauge ratio={prog.ratio} />}
        {prog && !done && <span className="small muted">{prog.text}{prog.endOfTurn ? " · vérifiée en fin de tour" : ""}</span>}
      </div>
    );
    // The Word : le joueur propose un mot, les autres votent.
    const wordFor = id === "VC-EMI-1" && isPlayer && !g.wordClaim &&
      ((holder === uid && !g.players[uid].personalDone) || (g.commonVC === id && !g.commonDone.includes(E.teamKey(room, uid))));
    const letters = isPlayer ? lettersOf(g.players[uid]) : [];
    const wordBox = wordFor && onClaimWord ? (
      <div className="word-box">
        <span className="small">Tes lettres : <b>{letters.join(" ") || "aucune"}</b></span>
        <div className="row">
          <input value={word} onChange={(e) => setWord(e.target.value)} placeholder="Ton mot (plus de 3 lettres)" />
          <button className="primary" disabled={!wordFits(word, letters)} onClick={() => { onClaimWord(word); onClose(); }}>Proposer</button>
        </div>
      </div>
    ) : null;
    if (autoVC) {
      actions = holder ? (
        <>{line(`Condition de ${E.nameOf(room, holder)}`, g.players[holder].personalDone, vcProgress(room, g, id, holder))}{wordBox}</>
      ) : g.commonVC === id ? (
        <>
          <span className="small muted">Condition commune :</span>
          {[...new Set(g.order.map((u) => E.teamKey(room, u)))].map((t) => (
            <div key={t}>{line(E.teamLabel(room, t), g.commonDone.includes(t), teamProgress(room, g, t)?.prog ?? null)}</div>
          ))}
          {wordBox}
        </>
      ) : null;
    } else
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
          <button className="primary" disabled={g.phase !== "action" || (room.auto !== false && !!noPlayReason(g, id))} onClick={() => onPlace({ id, from: "hand" })}>Poser sur mon terrain…</button>
          {room.auto !== false && noPlayReason(g, id) && <span className="small error">{noPlayReason(g, id)}</span>}
          <button disabled={g.phase !== "action" || !onDiscard} onClick={() => { onDiscard?.(id); onClose(); }}>Défausser (action du tour)</button>
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
          <p className="card-text"><KwText text={c.text} /></p>
          {c.rules && <p className="small rules"><b>Précisions :</b> {c.rules}</p>}
          <Modifiers id={id} room={room} />
          <div className="card-actions">{actions}</div>
          {!myTurn && isPlayer && c.kind === "card" && <p className="small muted">Seul le joueur dont c'est le tour peut agir.</p>}
          <button className="ghost" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}

type Mod = { icon: string; label: string; kind: "buff" | "debuff" | "info"; details: string[] };

/** Durée d'une désactivation, en clair. */
function untilText(room: Room, g: GameState, u: Partial<Until>) {
  if (!u.uid) return "jusqu'à nouvel ordre (ou jusqu'à ce qu'elle retourne dans une pioche, une main ou une défausse)";
  if ((u.after ?? 0) < E.pos(g)) return "jusqu'à la fin du tour en cours";
  return u.edge === "start" ? `jusqu'au début du prochain tour de ${E.nameOf(room, u.uid)}` : `jusqu'à la fin du prochain tour de ${E.nameOf(room, u.uid)}`;
}

/** Buffs, débuffs et modifications en cours sur une carte, avec leur origine, leur durée et leurs valeurs. */
export function modifiersOf(room: Room, g: GameState, id: string): Mod[] {
  const out: Mod[] = [];
  const at = E.locate(g, id);
  const name = (u?: string) => (u ? E.nameOf(room, u) : "?");
  const cardName = (c?: string) => (c ? `« ${card(c).name} »` : "un effet");
  const d = g.disabled?.[id];
  if (d) {
    const by = g.disabledBy?.[id];
    const details = [`Durée : ${untilText(room, g, d)}.`];
    if (by?.src) details.unshift(`Origine : ${cardName(by.src)}${by.by ? `, lancée par ${name(by.by)}` : ""}.`);
    else if (by?.by) details.unshift(`Origine : effet lancé par ${name(by.by)}.`);
    if (by?.at !== undefined) details.push(`Depuis le tour ${by.at + 1}.`);
    if (g.facedown?.includes(id)) details.push("Face cachée (« Cache Oeil ») : elle se retourne à son prochain passage en phase 1, sans jouer son effet.");
    out.push({ icon: "⛔", label: "Désactivée", kind: "debuff", details });
  } else if (at?.zone === "terrain" && E.isDisabled(g, id)) {
    const drone = g.order.find((u) => u !== at.uid && g.players[u].terrain[at.index] === E.DRONE);
    out.push({ icon: "⛔", label: "Désactivée par un drone", kind: "debuff", details: [`Origine : ${cardName(E.DRONE)} de ${name(drone)}, à la même place (${at.index + 1}) sur un terrain voisin.`, "Durée : tant que le drone reste en face et actif."] });
  }
  if (g.hot?.includes(id)) out.push({ icon: "☀️", label: "Hot", kind: "debuff", details: [`Origine : ${cardName("MET-05")}.`, "Au moment de se jouer : 1d2, sur un 2 elle ne se joue pas.", "Durée : une seule fois, à son prochain passage."] });
  const under = g.under?.[id] ?? [];
  if (under.length)
    out.push({
      icon: "⬇️", label: `${under.length} carte(s) dessous`, kind: "info",
      details: under.map((u) => `${cardName(u)}${g.underFrom?.[u] ? ` (venue du terrain de ${name(g.underFrom[u].uid)})` : ""}${u === "GRE-21" ? " : les choix de cette carte se font au hasard" : ""}`),
    });
  for (const [host, list] of Object.entries(g.under ?? {}))
    if (list.includes(id)) out.push({ icon: "⬇️", label: "Sous une autre carte", kind: "debuff", details: [host === E.SNOW ? "Ensevelie sous la neige : elle ressort au dégel." : `Sous ${cardName(host)}.`] });
  if (g.tempTags?.includes(id)) out.push({ icon: "🧠", label: "Tag Sentience ajouté", kind: "buff", details: ["Durée : jusqu'à la fin du tour en cours."] });
  if (g.cardStore?.[id]) out.push({ icon: "💰", label: `Réserve : ${g.cardStore[id]} gold`, kind: "info", details: ["Gold stockés sur cette carte par son effet."] });
  if (g.spent?.includes(id)) out.push({ icon: "⏳", label: "Effet utilisé", kind: "info", details: ["Elle rejouera au prochain tour de son joueur."] });
  if (g.armed?.includes(id)) {
    const m = g.marks?.[id];
    const target = m && g.players[m.split(/[|:]/)[0]] ? ` (cible / lanceur : ${name(m.split(/[|:]/)[0])})` : "";
    out.push({ icon: "⏱", label: "Effet en attente", kind: "info", details: [`Son effet se déclenchera plus tard, comme indiqué sur la carte${target}.`] });
  }
  if (g.revealed?.includes(id) && at?.zone === "hand") out.push({ icon: "👁", label: "Face visible", kind: "info", details: [`Tout le monde voit cette carte dans la main de ${name(at.uid)}.`] });
  if (g.custody?.host === id) out.push({ icon: "🚔", label: "Garde à vue active", kind: "info", details: [`Lancée par ${name(g.custody.uid)} : les prochaines cartes désactivées vont sous cette carte.`] });
  if (at?.zone === "terrain" && (g.doubleNow === at.uid || g.double?.includes(at.uid)))
    out.push({ icon: "⛵", label: "Se joue deux fois", kind: "buff", details: [`Origine : ${cardName("PIR-08")}.`, g.doubleNow === at.uid ? "Durée : ce tour-ci." : `Durée : le prochain tour de ${name(at.uid)}.`] });
  const owner = g.owner[id];
  if (owner && at && owner !== at.uid) out.push({ icon: "🔀", label: "Chez un autre joueur", kind: "info", details: [`Appartient à ${name(owner)}, se trouve chez ${name(at.uid)}.`] });
  return out;
}

function Modifiers({ id, room }: { id: string; room: Room }) {
  const g = room.game!;
  const mods = modifiersOf(room, g, id);
  if (!mods.length) return null;
  return (
    <div className="mods">
      <b className="small">Effets en cours</b>
      {mods.map((m, i) => (
        <details key={i} className={`mod mod-${m.kind}`} open={mods.length <= 2}>
          <summary>{m.icon} {m.label}</summary>
          {m.details.map((d, j) => <span key={j} className="small">{d}</span>)}
        </details>
      ))}
    </div>
  );
}
