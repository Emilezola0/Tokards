import { useEffect, useState, type ReactNode } from "react";
import { PLACEHOLDER, cardImage } from "../data/cards";
import { sfx } from "./sfx";

// Patch notes illustrées : on garde seulement les 3 dernières versions (la plus récente d'abord).
function Img({ id, cls = "" }: { id: string; cls?: string }) {
  return <img className={`hg-card ${cls}`} src={cardImage(id)} alt="" onError={(e) => (e.currentTarget.src = PLACEHOLDER)} />;
}
const Arrow = ({ cls = "hg-pulse" }: { cls?: string }) => <span className={`hg-arrow ${cls}`}>➜</span>;

type Note = { title: string; scene: ReactNode; text: ReactNode };
type Patch = { version: string; date: string; notes: Note[] };

const PATCHES: Patch[] = [
  {
    version: "0.27.0",
    date: "20 novembre 2026",
    notes: [
      {
        title: "🏆 Résumé de victoire",
        scene: (
          <div className="hg-scene hg-row">
            <div className="pn-log">
              <span className="pn-line l0">✨ active « Coffre »</span>
              <span className="pn-line l1">💰 +50 gold</span>
              <span className="pn-line l2">✔ condition remplie</span>
            </div>
            <Arrow />
            <span className="hg-trophy">🏆</span>
          </div>
        ),
        text: <>Quand une équipe gagne, la fenêtre de victoire rappelle ses conditions remplies et les dernières actions qui l'ont menée à la victoire.</>,
      },
      {
        title: "👮 Police : des effets à chaque activation",
        scene: (
          <div className="hg-scene hg-row">
            <Img id="POL-05" cls="hg-act" />
            <Img id="POL-09" cls="hg-act a1" />
            <Img id="POL-25" cls="hg-act a2" />
            <Arrow />
            <span className="pn-big">🔁</span>
          </div>
        ),
        text: (
          <>Ministre de l'intérieur (+50 💰), Préfet de police (pioche 1 carte) et Fonctionnaire corrompu (pot-de-vin facultatif) jouent maintenant
            cet effet <b>à chaque fois qu'ils s'activent</b>, plus seulement à leur arrivée. Leurs passifs ne changent pas.</>
        ),
      },
      {
        title: "🐢 Tardigrade en chaîne",
        scene: (
          <div className="hg-scene hg-row">
            <span className="pn-chip bad">−💰</span>
            <Arrow />
            <Img id="FLE-09" cls="hg-pop" />
            <Arrow />
            <span className="pn-big pn-spin">🔄</span>
          </div>
        ),
        text: <>Si la carte rejouée par Tardigrade vous fait encore perdre des gold, il se relance. À 0 gold on ne perd plus rien, donc la chaîne s'arrête.</>,
      },
      {
        title: "⛳ Hole in one",
        scene: (
          <div className="hg-scene hg-row">
            <Img id="VC-BASE-3" cls="hg-pop" />
            <div className="pn-bh">
              {["Primordial", "Quasar", "Blazard", "Trou de ver"].map((b, i) => <span key={b} className={`pn-chip d${i}`}>🌀 {b}</span>)}
            </div>
          </div>
        ),
        text: <>Nouvelle condition : passer par <b>les 4 états de trou noir</b> en 4 tours de table.</>,
      },
      {
        title: "🔊 Voix plus légères",
        scene: (
          <div className="hg-scene hg-row">
            <span className="pn-big">🗣️</span><span className="pn-big">🗣️</span><span className="pn-big pn-off">🗣️</span>
          </div>
        ),
        text: <>Au plus 2 voix en même temps, et une carte qui subit un effet a une voix moins grave qu'avant.</>,
      },
    ],
  },
  {
    version: "0.26.0",
    date: "20 novembre 2026",
    notes: [
      {
        title: "🪝 Crochet : garder ou défausser",
        scene: (
          <div className="hg-scene hg-row">
            <Img id="PIR-05" cls="hg-pop" />
            <Arrow />
            <div className="hg-deck"><span /><span /><span /><b>+1</b></div>
            <Arrow />
            <div className="pn-choice"><span className="pn-btn">La garder</span><span className="pn-btn alt">La défausser</span></div>
          </div>
        ),
        text: <>Avec la 🧠 vraie, Crochet fait piocher une carte, puis vous choisissez de la garder ou de la défausser. Les autres joueurs ne voient pas la carte piochée.</>,
      },
    ],
  },
  {
    version: "0.25.0",
    date: "19 novembre 2026",
    notes: [
      {
        title: "🎲 L'aperçu ne dévoile plus le hasard",
        scene: (
          <div className="hg-scene hg-row">
            <Img id="PIR-19" />
            <Arrow />
            <span className="hg-die">?</span>
          </div>
        ),
        text: (
          <>Au survol d'une carte, l'aperçu ne montre plus le résultat d'un dé ou de cartes cachées (comme Coffre). Il indique seulement que le
            résultat dépend du hasard : vous le découvrez en jouant la carte.</>
        ),
      },
    ],
  },
];

const SEEN = "tokards.patchSeen";
const latest = PATCHES[0].version;
const readSeen = () => {
  try {
    return localStorage.getItem(SEEN);
  } catch {
    return null;
  }
};

export default function PatchNotes() {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(0);
  const [fresh, setFresh] = useState(() => readSeen() !== latest);
  useEffect(() => {
    if (!open) return;
    setFresh(false);
    try {
      localStorage.setItem(SEEN, latest);
    } catch {
      /* stockage indisponible */
    }
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setV((x) => Math.max(0, x - 1));
      if (e.key === "ArrowLeft") setV((x) => Math.min(PATCHES.length - 1, x + 1));
      if (e.key === "Escape") setOpen(false);
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [open]);
  const p = PATCHES[v];
  return (
    <>
      <button className={`patch-fab ${fresh ? "fresh" : ""}`} title="Nouveautés (patch notes)" onClick={() => (sfx.click(), setV(0), setOpen(true))}>
        📜
      </button>
      {open && (
        <div className="modal-bg" onClick={() => setOpen(false)}>
          <div className="modal panel help-guide patch-notes" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <h2 className="grow">📜 Nouveautés</h2>
              <button className="ghost" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="pn-tabs">
              {PATCHES.map((x, i) => (
                <button key={x.version} className={i === v ? "primary" : "ghost"} onClick={() => setV(i)}>
                  v{x.version}{i === 0 && <span className="pn-new">nouveau</span>}
                </button>
              ))}
            </div>
            <div key={p.version} className="pn-list">
              <div className="small muted">{p.date}</div>
              {p.notes.map((n, i) => (
                <div key={n.title} className="hg-slide pn-note" style={{ animationDelay: `${i * 90}ms` }}>
                  <h3>{n.title}</h3>
                  {n.scene}
                  <p>{n.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
