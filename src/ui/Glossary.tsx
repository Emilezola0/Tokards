import { useEffect, useMemo, useState, type ReactNode } from "react";
import { GLOSSARY, PLACEHOLDER, cardImage } from "../data/cards";
import { BH_SYMBOL, BLACK_HOLES } from "../game/types";
import KwText, { catClass } from "./KwText";
import { sfx } from "./sfx";

const CATS = ["Ressource", "Carte", "Zone", "Action", "Joueur", "Règle"];
const A = "GOB-01";
const B = "POP-02";
const C = "FLE-05";

const Card = ({ id = A, cls = "" }: { id?: string; cls?: string }) => (
  <img className={`ga-card ${cls}`} src={cardImage(id)} alt="" onError={(e) => (e.currentTarget.src = PLACEHOLDER)} />
);
const Back = ({ cls = "" }: { cls?: string }) => <span className={`ga-card ga-back ${cls}`} />;
const Pile = ({ label, children }: { label: string; children?: ReactNode }) => (
  <span className="ga-pile"><span className="ga-slot">{children}</span><small>{label}</small></span>
);
const Who = ({ n, cls = "" }: { n: string; cls?: string }) => <span className={`ga-who ${cls}`}>{n}</span>;
const Arrow = ({ cls = "" }: { cls?: string }) => <span className={`ga-arrow ${cls}`}>➜</span>;

/** Petite scène animée qui illustre un mot du glossaire. */
export function GlossAnim({ anim }: { anim: string }) {
  switch (anim) {
    case "gold":
      return (
        <div className="ga ga-row">
          <span className="ga-chip gold">💰 <b className="ga-count">10 → 20</b></span>
          <span className="ga-coin up">+10</span>
          <span className="ga-coin down">−5</span>
        </div>
      );
    case "sentience":
      return (
        <div className="ga ga-row">
          <span className="ga-toggle"><span className="on">🧠 Vraie</span><span className="off">🧠 Fausse</span></span>
        </div>
      );
    case "blackhole":
    case "cycle":
      return (
        <div className="ga ga-row ga-cycle">
          {BLACK_HOLES.map((b, i) => (
            <span key={b.id} className="ga-state" style={{ animationDelay: `${i * 0.6}s` }}>
              <b>{BH_SYMBOL[b.id]}</b><small>{b.id}</small>
              {i < 3 && <Arrow />}
            </span>
          ))}
        </div>
      );
    case "resources":
      return (
        <div className="ga ga-row">
          <span className="ga-chip pop d0">🧠 Sentience</span><span className="ga-chip pop d1">🌀 Trou noir</span><span className="ga-chip gold pop d2">💰 Gold</span>
        </div>
      );
    case "tags":
      return (
        <div className="ga ga-row">
          <span className="ga-tagged"><Card id={B} /><span className="ga-tagbadge">💰</span></span>
          <span className="ga-tagged"><Card id="GOB-26" /><span className="ga-tagbadge">🧠🌀</span></span>
        </div>
      );
    case "activate":
      return <div className="ga ga-row"><Card cls="ga-glow" /><span className="ga-spark">✨</span></div>;
    case "passive":
      return (
        <div className="ga ga-row">
          <Who n="💰 +10" cls="ga-blink" /><Arrow cls="ga-pulse" /><Card id={C} cls="ga-aura" /><span className="ga-spark late">⚡</span>
        </div>
      );
    case "zones":
      return (
        <div className="ga ga-row">
          <Pile label="Pioche"><Back /></Pile>
          <Pile label="Main"><span className="ga-fan"><Card id={B} /><Card id={C} /></span></Pile>
          <Pile label="Terrain"><span className="ga-terrain"><Card /><Card id={B} /></span></Pile>
          <Pile label="Défausse"><Card id={C} cls="ga-tilt" /></Pile>
        </div>
      );
    case "positions":
      return (
        <div className="ga ga-row ga-terrain big">
          {[A, B, C, "GOB-04"].map((id, i) => (
            <span key={id} className="ga-pos"><Card id={id} cls={i === 0 || i === 3 ? "ga-glow" : ""} /><small>{i === 0 ? "1re" : i === 3 ? "dernière" : i + 1}</small></span>
          ))}
        </div>
      );
    case "draw":
      return <div className="ga ga-row"><Pile label="Pioche"><Back /><Back cls="ga-move-r" /></Pile><Arrow /><Pile label="Main"><span className="ga-fan"><Card id={B} /></span></Pile></div>;
    case "play":
      return <div className="ga ga-row"><Pile label="Main"><Card cls="ga-move-r" /></Pile><Arrow /><Pile label="Terrain"><span className="ga-terrain"><Card id={B} /><span className="ga-ghost" /></span></Pile></div>;
    case "discard":
      return <div className="ga ga-row"><Pile label="Terrain"><span className="ga-terrain"><Card id={B} /><Card cls="ga-move-r" /></span></Pile><Arrow /><Pile label="Défausse"><Card id={C} cls="ga-tilt" /></Pile></div>;
    case "spend":
      return (
        <div className="ga ga-row">
          <span className="ga-chip gold">💰 10</span><span className="ga-coin fly-r">−10</span><Arrow /><Card cls="ga-glow" />
          <span className="ga-note">Pas assez ? Rien n'est payé et l'effet n'a pas lieu.</span>
        </div>
      );
    case "give":
      return <div className="ga ga-row"><Who n="🙂 Toi" /><span className="ga-coin fly-r">🪙</span><Arrow /><Who n="🙂 Cible" /></div>;
    case "steal":
      return <div className="ga ga-row"><Who n="🦹 Toi" /><Arrow cls="ga-flip" /><span className="ga-coin fly-l">🪙</span><Who n="😟 Cible" /></div>;
    case "swap":
      return <div className="ga ga-row ga-swap"><Card cls="sw-a" /><span className="ga-arrow">⇄</span><Card id={B} cls="sw-b" /></div>;
    case "shuffle":
      return <div className="ga ga-row ga-shuffle"><Back cls="s1" /><Back cls="s2" /><Back cls="s3" /></div>;
    case "remove":
      return <div className="ga ga-row"><Card cls="ga-vanish" /><span className="ga-note">Ne revient dans aucune zone.</span></div>;
    case "lock":
      return <div className="ga ga-row"><span className="ga-chip">🧠 Vraie</span><span className="ga-chip">🌀 Quasar</span><span className="ga-lock">🔒</span></div>;
    case "dice":
      return <div className="ga ga-row"><span className="ga-cube">6</span><Arrow /><b className="ga-big">4</b></div>;
    case "bhdice":
      return <div className="ga ga-row"><span className="ga-cube">{BH_SYMBOL.Blazard}</span><Arrow /><b className="ga-big">{BH_SYMBOL.Blazard} Blazard</b></div>;
    case "target":
      return <div className="ga ga-row"><Who n="✨ Lanceur" /><Arrow cls="ga-pulse" /><Who n="🎯 Cible" cls="ga-blink" /></div>;
    case "team":
      return <div className="ga ga-row"><Who n="🙂 Alice" /><span className="ga-link">🤝</span><Who n="🙂 Bob" /><span className="ga-note">même équipe</span></div>;
    case "rich":
      return (
        <div className="ga ga-row ga-bars">
          <span style={{ height: 70 }}><small>👑</small></span><span style={{ height: 40 }} /><span style={{ height: 14 }}><small>🥺</small></span>
        </div>
      );
    case "interaction":
      return <div className="ga ga-row"><Who n="🙂 A" /><span className="ga-zap">⚡</span><Who n="🙂 B" cls="ga-blink" /><span className="ga-note">gold, sentience, trou noir ou cartes</span></div>;
    case "turn":
      return (
        <div className="ga ga-row ga-steps">
          {["1 · Activation", "2 · Poser / défausser", "3 · Pioche"].map((t, i) => <span key={t} style={{ animationDelay: `${i * 0.9}s` }}>{t}</span>)}
        </div>
      );
    case "round":
      return (
        <div className="ga ga-round">
          {["A", "B", "C", "D"].map((n, i) => <span key={n} className="ga-seat" style={{ ["--i" as string]: i }}>{n}</span>)}
          <span className="ga-hand-ptr">▶</span>
        </div>
      );
    case "percent":
      return <div className="ga ga-row"><span className="ga-chip gold">💰 37</span><Arrow /><b className="ga-big">10 % = 3</b></div>;
    case "weather":
      return (
        <div className="ga ga-row">
          {BLACK_HOLES.map((b) => <span key={b.id} className="ga-state still"><b>{b.icon}</b><small>{b.weather}</small></span>)}
        </div>
      );
    case "disable":
      return <div className="ga ga-row"><Card cls="ga-off" /><span className="ga-lock">⛔</span><span className="ga-note">Reste en place, n'agit plus.</span></div>;
    case "under":
      return <div className="ga ga-row ga-under"><Card id={B} cls="u-host" /><Card cls="u-slide" /><span className="ga-note">⤵ dessous</span></div>;
    case "sentdice":
      return <div className="ga ga-row"><span className="ga-cube">✔</span><Arrow /><b className="ga-big">🧠 Vraie</b></div>;
    case "random":
      return <div className="ga ga-row"><Who n="🙂 A" /><Who n="🙂 B" cls="ga-blink" /><Who n="🙂 C" /><span className="ga-note">🎯 tirage annoncé</span></div>;
    case "neighbours":
      return <div className="ga ga-row"><Who n="⬅ Gauche (avant)" /><Who n="✨ Toi" /><Who n="Droite (après) ➡" /></div>;
    default:
      return <div className="ga ga-row"><Card cls="ga-glow" /></div>;
  }
}

/** Bouton « 📖 » présent sur tous les écrans : le glossaire illustré des mots des cartes. */
export default function Glossary() {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string>(GLOSSARY[0]?.term ?? "");
  const [cat, setCat] = useState<string>("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const h = (e: Event) => {
      const t = (e as CustomEvent<string | null>).detail;
      if (t) setSel(t);
      setCat("");
      setQ("");
      setOpen(true);
    };
    addEventListener("tokards:glossary", h);
    return () => removeEventListener("tokards:glossary", h);
  }, []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [open]);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return GLOSSARY.filter((g) => (!cat || g.cat === cat) && (!n || `${g.term} ${g.def} ${g.words.join(" ")}`.toLowerCase().includes(n)));
  }, [cat, q]);
  const e = GLOSSARY.find((g) => g.term === sel) ?? list[0];
  if (!GLOSSARY.length) return null;
  return (
    <>
      <button className="gloss-fab" title="Glossaire : le sens des mots des cartes" onClick={() => (sfx.click(), setOpen(true))}>📖</button>
      {open && (
        <div className="modal-bg" onClick={() => setOpen(false)}>
          <div className="modal panel glossary" onClick={(ev) => ev.stopPropagation()}>
            <div className="row">
              <h2 className="grow">📖 Glossaire</h2>
              <input className="gloss-search" placeholder="Rechercher…" value={q} onChange={(ev) => setQ(ev.target.value)} />
              <button className="ghost" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="gloss-cats">
              <button className={!cat ? "on" : ""} onClick={() => setCat("")}>Tout</button>
              {CATS.map((c) => (
                <button key={c} className={`kw-${catClass(c)} ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>{c}</button>
              ))}
            </div>
            <div className="gloss-body">
              <ul className="gloss-list">
                {list.map((g) => (
                  <li key={g.term}>
                    <button className={`${e?.term === g.term ? "on" : ""}`} onClick={() => (sfx.click(), setSel(g.term))}>
                      <span className={`gloss-dot kw-${catClass(g.cat)}`} />{g.term}
                    </button>
                  </li>
                ))}
                {!list.length && <li className="muted small">Aucun mot trouvé.</li>}
              </ul>
              {e && (
                <div key={e.term} className="gloss-detail">
                  <span className={`gloss-cat kw-${catClass(e.cat)}`}>{e.cat}</span>
                  <h3>{e.term}</h3>
                  <GlossAnim anim={e.anim} />
                  <p className="gloss-def"><KwText text={e.def} /></p>
                  {e.example && <p className="gloss-ex">Exemple : « <KwText text={e.example} /> »</p>}
                  {!!e.words.length && (
                    <p className="small muted">Sur les cartes : {e.words.map((w) => <span key={w} className={`kw kw-${catClass(e.cat)}`}>{w}</span>)}</p>
                  )}
                </div>
              )}
            </div>
            <p className="small muted">Astuce : sur une carte, les mots en couleur renvoient ici (survol = définition, clic = glossaire).</p>
          </div>
        </div>
      )}
    </>
  );
}
