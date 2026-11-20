import { useEffect, useState, type ReactNode } from "react";
import { PLACEHOLDER, cardImage, deckBack } from "../data/cards";
import { sfx } from "./sfx";

// Patch notes illustrées : on garde seulement les 5 dernières versions (la plus récente d'abord).
function Img({ id, cls = "" }: { id: string; cls?: string }) {
  return <img className={`hg-card ${cls}`} src={cardImage(id)} alt="" onError={(e) => (e.currentTarget.src = PLACEHOLDER)} />;
}
const Arrow = ({ cls = "hg-pulse" }: { cls?: string }) => <span className={`hg-arrow ${cls}`}>➜</span>;

type Cat = "jeu" | "cartes" | "visuel" | "fix";
type Note = { cat: Cat; title: string; scene: ReactNode; text: ReactNode };
/** Rubriques des patch notes, dans l'ordre d'affichage. */
const CATS: { id: Cat; label: string }[] = [
  { id: "jeu", label: "🎮 Jeu et interface" },
  { id: "cartes", label: "🃏 Cartes et conditions" },
  { id: "visuel", label: "🎨 Images, effets et son" },
  { id: "fix", label: "🛠️ Corrections" },
];
type Patch = { version: string; date: string; notes: Note[] };

const PATCHES_ALL: Patch[] = [
  {
    version: "0.30.0",
    date: "20 novembre 2026",
    notes: [
      {
        cat: "jeu",
        title: "🔊 Écouter une voiceline",
        scene: (
          <div className="hg-scene hg-row">
            <Img id="POP-04" cls="hg-pop" />
            <Arrow />
            <span className="pn-chip pn-glow">🔊 Écouter la voiceline</span>
          </div>
        ),
        text: <>Le détail d'une carte a un bouton pour réécouter sa voiceline.</>,
      },
      {
        cat: "jeu",
        title: "⬇️ Cartes empilées",
        scene: (
          <div className="hg-scene hg-row">
            <Img id="POL-07" cls="hg-pop" />
            <Arrow />
            <Img id="GOB-03" cls="pn-off" />
          </div>
        ),
        text: <>Le détail d'une carte montre les cartes posées dessous, ou la carte sous laquelle elle se trouve. Clique-les pour ouvrir leur détail.</>,
      },
      {
        cat: "jeu",
        title: "🂠 Le deck reste derrière",
        scene: (
          <div className="hg-scene hg-row">
            <span className="pn-chip">🂠 Deck</span>
            <Arrow />
            <Img id="EMI-01" cls="hg-pop" />
            <Arrow />
            <span className="pn-chip pn-glow">🂠 Deck</span>
          </div>
        ),
        text: <>Le détail d'une carte s'ouvre par-dessus la fenêtre du deck ou des conditions de victoire : en le fermant, on revient là où on était. Ces fenêtres sont aussi rangées en rubriques.</>,
      },
      {
        cat: "jeu",
        title: "👁 Spectateurs",
        scene: (
          <div className="hg-scene hg-row">
            <span className="pn-chip">👁 Spectateur</span>
            <Arrow />
            <Img id="MET-03" cls="hg-pop" /><Img id="PIR-02" cls="hg-pop d1" />
          </div>
        ),
        text: <>Les spectateurs peuvent ouvrir le détail des cartes dans la main de tous les joueurs.</>,
      },
      {
        cat: "jeu",
        title: "⚖️ Demande de retrait",
        scene: (
          <div className="hg-scene hg-row">
            <span className="pn-chip">⚖️ Demande de retrait de contenu</span>
          </div>
        ),
        text: <>Un lien en bas de l'accueil permet de demander le retrait d'un son ou d'une image : la demande arrive sous forme de ticket.</>,
      },
      {
        cat: "cartes",
        title: "🐀 Rat",
        scene: (
          <div className="hg-scene hg-row">
            <span className="pn-chip">Adversaire −5 💰</span>
            <Arrow />
            <Img id="PIR-07" cls="hg-pop" />
            <Arrow />
            <span className="pn-chip pn-glow">Propriétaire +💰</span>
          </div>
        ),
        text: <>Celui qui pose le Rat en devient propriétaire : le rat ne lui fait jamais rien. Chez un adversaire, il garde les gold qu'il lui fait perdre, puis a 1 chance sur 2 de rentrer chez son propriétaire pour lui rapporter tout son butin. Le défausser est le seul moyen de l'empêcher de rentrer : son butin est alors perdu.</>,
      },
      {
        cat: "visuel",
        title: "🗣 Nouvelles voicelines",
        scene: (
          <div className="hg-scene hg-row pn-gallery">
            <Img id="POP-01" /><Img id="PIR-01" /><Img id="MET-01" /><Img id="EMI-02" />
          </div>
        ),
        text: <>Voicelines pour Popo emplois, Pirate, Météo et Emile (ces dernières moins fortes, sans saturation). Une carte dont l'effet est impossible parle aussi, plus grave.</>,
      },
      {
        cat: "visuel",
        title: "🎵 Prêt et arrivée en partie",
        scene: (
          <div className="hg-scene hg-row">
            <span className="pn-btn">✔ Prêt</span>
            <Arrow />
            <span className="pn-chip pn-glow">🗣 voiceline du deck</span>
          </div>
        ),
        text: <>Quand un joueur se met prêt, une voiceline de son deck est jouée pour tout le monde. Un son de transition accompagne l'arrivée dans la partie.</>,
      },
      {
        cat: "visuel",
        title: "🖼️ Nouvelles images",
        scene: (
          <div className="hg-scene hg-row pn-gallery">
            <Img id="VC-FLE-1" /><Img id="VC-FLE-2" /><Img id="VC-FLE-3" /><Img id="VC-POP-1" /><Img id="VC-POP-2" /><Img id="VC-POP-3" />
          </div>
        ),
        text: <>Images des conditions de victoire Fléaux et Popo emplois, et nouveau dos du deck Popo emplois.</>,
      },
      {
        cat: "visuel",
        title: "📖 Glossaire rangé",
        scene: (
          <div className="hg-scene hg-row">
            <span className="pn-chip">Ressource</span><span className="pn-chip">Carte</span><span className="pn-chip">Zone</span><span className="pn-chip">Action</span>
          </div>
        ),
        text: <>Les mots du glossaire sont regroupés par catégorie et triés par ordre alphabétique. Les patch notes sont aussi plus aérées entre deux sujets.</>,
      },
      {
        cat: "fix",
        title: "🌀 Fond du joueur actif",
        scene: (
          <div className="hg-scene hg-row">
            <span className="pn-big">🌀</span>
          </div>
        ),
        text: <>Le dos du deck affiché en fond est bien fondu en cercle sur tous ses bords.</>,
      },
    ],
  },
  {
    version: "0.29.0",
    date: "20 novembre 2026",
    notes: [
      {
        cat: "jeu",
        title: "🎯 Roulette des joueurs",
        scene: (
          <div className="hg-scene hg-row">
            <div className="pn-wheel"><span>▼</span></div>
            <Arrow />
            <span className="pn-chip">🎯 joueur tiré au sort</span>
          </div>
        ),
        text: <>Quand un effet choisit un joueur au hasard, une roulette avec les joueurs tourne d'abord. La suite de l'effet n'arrive qu'une fois le résultat affiché.</>,
      },
      {
        cat: "jeu",
        title: "🔦 Toutes les cibles possibles",
        scene: (
          <div className="hg-scene hg-row">
            <Img id="GRE-08" cls="hg-pop" />
            <Arrow />
            <span className="pn-chip pn-glow">Joueur A</span><span className="pn-chip pn-glow d1">Joueur B</span><span className="pn-chip pn-glow d2">Joueur C</span>
          </div>
        ),
        text: <>Au survol d'une carte au résultat aléatoire, tout ce qu'elle peut toucher est surligné, sans indiquer ce qui sera vraiment touché.</>,
      },
      {
        cat: "jeu",
        title: "📜 Patch notes par rubrique",
        scene: (
          <div className="hg-scene hg-row">
            {CATS.map((c, i) => <span key={c.id} className={`pn-chip pn-glow d${i}`}>{c.label}</span>)}
          </div>
        ),
        text: <>Les nouveautés sont rangées par rubrique : jeu et interface, cartes, images et son, corrections.</>,
      },
      {
        cat: "cartes",
        title: "🐸 Crapaud stratège",
        scene: (
          <div className="hg-scene hg-row">
            <Img id="GRE-21" cls="hg-pop" />
            <Arrow />
            <div className="pn-wheel small"><span>▼</span></div>
          </div>
        ),
        text: <>Au début de chaque tour, le joueur pour qui joue la carte sous le Crapaud est tiré au sort (son vrai propriétaire peut être tiré). Ses choix restent faits au hasard.</>,
      },
      {
        cat: "cartes",
        title: "💸 Poro money maker",
        scene: (
          <div className="hg-scene hg-row">
            <span className="pn-chip">Autre joueur</span>
            <Arrow />
            <Img id="POP-05" cls="hg-pop" />
            <span className="pn-chip">+10 💰</span>
          </div>
        ),
        text: <>Elle ne rapporte plus à chaque interaction du jeu : seulement quand un autre joueur interagit avec celui qui l'a.</>,
      },
    ],
  },
  {
    version: "0.28.0",
    date: "20 novembre 2026",
    notes: [
      {
        cat: "jeu",
        title: "🎲 Le dé d'abord, l'effet ensuite",
        scene: (
          <div className="hg-scene hg-row">
            <span className="hg-die">?</span>
            <Arrow />
            <Img id="POL-10" cls="hg-act" />
            <Arrow />
            <span className="pn-big">💥</span>
          </div>
        ),
        text: <>Quand une carte lance un dé, les cartes ne bougent plus avant que le dé soit tombé. Le journal attend aussi la fin des animations, pour ne pas dévoiler le résultat.</>,
      },
      {
        cat: "jeu",
        title: "🏆 Suspense jusqu'au bout",
        scene: (
          <div className="hg-scene hg-row">
            <span className="pn-chip">✨ effet de la carte…</span>
            <Arrow />
            <span className="hg-trophy">🏆</span>
          </div>
        ),
        text: <>Le vainqueur n'est révélé qu'une fois l'effet de la carte gagnante terminé : conditions cochées, journal et fenêtre de victoire arrivent ensemble.</>,
      },
      {
        cat: "visuel",
        title: "🎨 Nouvelles images",
        scene: (
          <div className="hg-scene hg-row pn-gallery">
            <img className="hg-card hg-pop" src={deckBack("Fléaux") ?? PLACEHOLDER} alt="" />
            {["VC-MET-1", "VC-MET-2", "VC-MET-3", "VC-EMI-1", "VC-EMI-2", "VC-EMI-3"].map((id, i) => <Img key={id} id={id} cls={`pn-deal d${i}`} />)}
          </div>
        ),
        text: <>Nouveau dos pour le deck Fléaux, et des illustrations pour Météo Rite, Temps Curieux et Pour Temps, Cent Temps, The Word, Pierre qui roule et Pas le paff.</>,
      },
      {
        cat: "visuel",
        title: "🖼️ Fond du plateau",
        scene: (
          <div className="hg-scene hg-row">
            <div className="pn-backdrop" style={{ backgroundImage: `url("${deckBack("Fléaux") ?? PLACEHOLDER}")` }} />
          </div>
        ),
        text: <>Le dos du deck du joueur actif s'affiche maintenant en entier au centre de la table, avec un fondu en cercle vers l'extérieur.</>,
      },
      {
        cat: "cartes",
        title: "💣 Démineur, Crocodilo et Tardigrade",
        scene: (
          <div className="hg-scene hg-row">
            <Img id="POL-10" cls="hg-pop" />
            <Img id="EMI-11" cls="hg-pop d1" />
            <Img id="FLE-09" cls="hg-pop" />
          </div>
        ),
        text: (
          <><b>Démineur</b> : 1 chance sur 2 de désactiver la cible, sinon c'est lui qui saute (défaussé). Dans tous les cas, ses voisines sont désactivées
            jusqu'à la fin de votre prochain tour. <b>Crocodilo Bombardino</b> : texte plus clair. <b>Tardigrade</b> : jusqu'à 10 relances en chaîne.</>
        ),
      },
    ],
  },
  {
    version: "0.27.0",
    date: "20 novembre 2026",
    notes: [
      {
        cat: "jeu",
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
        cat: "cartes",
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
        cat: "cartes",
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
        cat: "cartes",
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
        cat: "visuel",
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
        cat: "cartes",
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
        cat: "fix",
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
  {
    version: "0.24.0",
    date: "19 novembre 2026",
    notes: [
      {
        cat: "visuel",
        title: "✨ Plus d'effets visuels",
        scene: (
          <div className="hg-scene hg-row">
            <Img id="GOB-01" cls="hg-act" />
            <span className="hg-coin c1">🪙</span><span className="hg-coin c2">🪙</span><span className="hg-coin c3">🪙</span>
            <span className="pn-big pn-spin">🌀</span>
          </div>
        ),
        text: <>Anneaux à l'activation, étincelles sur les gains de gold, vortex au changement de trou noir, confettis quand une condition est remplie. Le dé 3D ne laisse plus de traces à l'écran.</>,
      },
      {
        cat: "jeu",
        title: "🔎 Aides à la lecture",
        scene: (
          <div className="hg-scene hg-row">
            <span className="pn-chip">Si tu l'actives : +20 💰</span>
            <span className="pn-chip bad">🚫</span>
            <span className="pn-chip">🔥 presque remplie</span>
          </div>
        ),
        text: <>Le survol d'une carte résume ce qu'elle ferait, les cartes impossibles à poser sont marquées 🚫, le journal se filtre (tout, ce tour, moi) et une condition presque remplie s'allume 🔥.</>,
      },
    ],
  },
];
/** Au plus 5 versions affichées. */
const PATCHES = PATCHES_ALL.slice(0, 5);

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
              {CATS.filter((c) => p.notes.some((n) => n.cat === c.id)).map((c, ci) => (
                <section key={c.id} className={`pn-cat pn-cat-${c.id}`} style={{ animationDelay: `${ci * 120}ms` }}>
                  <h4 className="pn-cat-title">{c.label}</h4>
                  {p.notes.filter((n) => n.cat === c.id).map((n, i) => (
                    <div key={n.title} className="hg-slide pn-note" style={{ animationDelay: `${ci * 120 + i * 90}ms` }}>
                      <h3>{n.title}</h3>
                      {n.scene}
                      <p>{n.text}</p>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
