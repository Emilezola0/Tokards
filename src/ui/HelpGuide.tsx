import { useEffect, useState, type ReactNode } from "react";
import { PLACEHOLDER, cardImage } from "../data/cards";
import { sfx } from "./sfx";

// Cartes servant d'illustrations (les images du jeu).
const A = "GOB-01";
const B = "POP-02";
const C = "GOB-04";
const D = "POP-09";
const VC = "VC-BASE-4";

function Img({ id, cls = "", style }: { id: string; cls?: string; style?: React.CSSProperties }) {
  return <img className={`hg-card ${cls}`} style={style} src={cardImage(id)} alt="" onError={(e) => (e.currentTarget.src = PLACEHOLDER)} />;
}
const Arrow = ({ cls = "" }: { cls?: string }) => <span className={`hg-arrow ${cls}`}>➜</span>;

type Slide = { title: string; scene: ReactNode; text: ReactNode };

const SLIDES: Slide[] = [
  {
    title: "Le but du jeu",
    scene: (
      <div className="hg-scene hg-row">
        <div className="hg-col"><Img id={VC} cls="hg-pop" /><span className="hg-tag">Condition commune</span></div>
        <span className="hg-plus">+</span>
        <div className="hg-col"><Img id="VC-GOB-1" cls="hg-pop d1" /><span className="hg-tag">Ta condition</span></div>
        <Arrow cls="hg-pulse" />
        <span className="hg-trophy">🏆</span>
      </div>
    ),
    text: (
      <>Chaque équipe doit remplir la <b>condition commune</b> (au centre de la table) et la <b>condition personnelle</b> de chacun de ses joueurs.
        Les jauges sous les conditions montrent l'avancement à tout le monde. La première équipe qui a tout rempli gagne.</>
    ),
  },
  {
    title: "Tes ressources",
    scene: (
      <div className="hg-scene hg-res">
        <span className="hg-chip ok">🧠 Sentience : Vraie</span>
        <span className="hg-chip">🌀 Trou noir : Primordial</span>
        <span className="hg-chip gold">💰 <span className="hg-odo">00010</span></span>
        <span className="hg-coin c1">🪙</span><span className="hg-coin c2">🪙</span><span className="hg-coin c3">🪙</span>
      </div>
    ),
    text: (
      <>Chaque joueur commence avec <b>10 gold</b>, la <b>sentience vraie</b> et le trou noir <b>Primordial</b>.
        Les cartes font gagner, perdre ou voler des gold et changent la sentience ou le trou noir (Quasar, Blazard, Trou de ver, Primordial).</>
    ),
  },
  {
    title: "Mise en place",
    scene: (
      <div className="hg-scene hg-row">
        <div className="hg-deck"><span /><span /><span /><b>32</b></div>
        <Arrow cls="hg-pulse" />
        <div className="hg-hand">
          {[A, B, C, D].map((id, i) => <Img key={id} id={id} cls={`hg-deal d${i}`} />)}
        </div>
        <span className="hg-die">20</span>
      </div>
    ),
    text: <>Chaque joueur a un deck de <b>32 cartes</b> et en pioche <b>4</b>. Un dé à 20 faces décide de l'ordre du tour.</>,
  },
  {
    title: "Phase 1 · Activation",
    scene: (
      <div className="hg-scene">
        <div className="hg-grid">
          {[A, B, C].map((id, i) => (
            <div key={id} className="hg-cell"><Img id={id} cls={`hg-act a${i}`} /><span className="hg-num">{i + 1}</span></div>
          ))}
          <div className="hg-cell empty" />
        </div>
        <div className="hg-read">1 ➜ 2 ➜ 3 (sens de lecture)</div>
      </div>
    ),
    text: (
      <>Au début de ton tour, les cartes de ton terrain s'activent <b>une par une, dans le sens de lecture</b>.
        Les cartes ⚙ s'appliquent toutes seules ; si un effet ne peut pas s'appliquer, la raison s'affiche. Tu ne peux rien poser pendant cette phase.</>
    ),
  },
  {
    title: "Phase 2 · Poser ou défausser",
    scene: (
      <div className="hg-scene hg-row">
        <div className="hg-hand small">
          <Img id={B} /><Img id={C} cls="hg-drag" /><Img id={D} />
        </div>
        <div className="hg-col">
          <div className="hg-target">Terrain</div>
          <div className="hg-target bad">Défausse</div>
        </div>
      </div>
    ),
    text: (
      <><b>Glisse une carte</b> de ta main sur ton terrain (elle s'active tout de suite) ou sur ta défausse.
        Tu dois obligatoirement faire l'un des deux. Survole une carte pour voir ce qu'elle va toucher.</>
    ),
  },
  {
    title: "Phase 3 · Pioche",
    scene: (
      <div className="hg-scene hg-row">
        <div className="hg-deck"><span /><span /><span /><b>27</b></div>
        <Arrow cls="hg-pulse" />
        <div className="hg-hand"><Img id={A} /><Img id={B} /><Img id={C} /><Img id={D} cls="hg-deal d0" /></div>
      </div>
    ),
    text: <>Tu pioches jusqu'à avoir <b>4 cartes</b> en main. Si ta pioche est vide, ta défausse est mélangée pour en refaire une.</>,
  },
  {
    title: "Passifs et interactions",
    scene: (
      <div className="hg-scene hg-row">
        <Img id="POP-05" cls="hg-aura" />
        <svg className="hg-svg" viewBox="0 0 160 60"><path d="M5,50 Q80,-10 150,45" /></svg>
        <Img id={C} cls="hg-hit" />
      </div>
    ),
    text: (
      <>Les cartes avec une <b>aura bleue ✨</b> sont passives : elles réagissent même pendant le tour des autres.
        Quand une carte agit sur une autre carte ou un autre joueur, une <b>flèche</b> le montre sur la table et dans le journal.</>
    ),
  },
  {
    title: "Les boutons utiles",
    scene: (
      <div className="hg-scene hg-buttons">
        <span className="hg-btn">📜 Effets <small>tout le terrain dans l'ordre</small></span>
        <span className="hg-btn">🂠 Deck <small>toutes les cartes du deck</small></span>
        <span className="hg-btn">📜 Journal <small>tout ce qui s'est passé</small></span>
        <span className="hg-btn">🔊 Son <small>volume</small></span>
        <span className="hg-btn">🏳 Abandonner <small>en haut à droite, si tu ne peux plus jouer</small></span>
        <span className="hg-btn">❔ Aide <small>ce guide</small></span>
      </div>
    ),
    text: <>Clique une carte pour la voir en grand avec ses précisions. Clique une condition (même remplie) pour revoir son détail.</>,
  },
];

/** Bouton « ? » présent sur tous les écrans, qui ouvre le guide illustré. */
export default function HelpGuide() {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setI((v) => Math.min(SLIDES.length - 1, v + 1));
      if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
      if (e.key === "Escape") setOpen(false);
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [open]);
  const s = SLIDES[i];
  return (
    <>
      <button className="help-fab" title="Comment jouer" onClick={() => (sfx.click(), setOpen(true))}>?</button>
      {open && (
        <div className="modal-bg" onClick={() => setOpen(false)}>
          <div className="modal panel help-guide" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <h2 className="grow">❔ Comment jouer <span className="muted small">{i + 1}/{SLIDES.length}</span></h2>
              <button className="ghost" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div key={i} className="hg-slide">
              <h3>{s.title}</h3>
              {s.scene}
              <p>{s.text}</p>
            </div>
            <div className="row hg-nav">
              <button disabled={i === 0} onClick={() => setI(i - 1)}>← Précédent</button>
              <span className="grow hg-dots">
                {SLIDES.map((_, k) => <span key={k} className={k === i ? "on" : ""} onClick={() => setI(k)} />)}
              </span>
              {i < SLIDES.length - 1
                ? <button className="primary" onClick={() => setI(i + 1)}>Suivant →</button>
                : <button className="primary" onClick={() => setOpen(false)}>C'est parti !</button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
