import { useEffect, useMemo, useRef } from "react";
import { BLACK_HOLES, BH_SYMBOL } from "../game/types";

export type DieRoll = {
  key: number;
  faces: number;
  value: number;
  /** dé trou noir : symboles des 4 états au lieu des chiffres */
  bh?: boolean;
  /** ce que le résultat a décidé (lignes du journal qui suivent le jet) */
  outcome?: string[];
  /** dé de sentience : ✔ Vraie / ✖ Fausse */
  sent?: boolean;
  who: string;
  color: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  dur: number;
  landed: boolean;
};

/** Rotation qui amène chaque face du cube vers l'avant. */
const FACE_POS = ["rotateY(0deg)", "rotateY(90deg)", "rotateY(180deg)", "rotateY(-90deg)", "rotateX(90deg)", "rotateX(-90deg)"];

const label = (r: { bh?: boolean; sent?: boolean }, v: number) =>
  r.bh ? BH_SYMBOL[BLACK_HOLES[v - 1]?.id ?? "Primordial"] : r.sent ? (v === 1 ? "✔" : "✖") : String(v);

/** Dé en 3D qui roule depuis le plateau du joueur jusqu'au centre de la table, puis affiche le résultat. */
export default function Die3D({ roll }: { roll: DieRoll }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cube = useRef<HTMLDivElement>(null);
  const shadow = useRef<HTMLDivElement>(null);
  // Face avant = résultat ; les autres faces montrent d'autres valeurs.
  const faces = useMemo(() => {
    const others: number[] = [];
    for (let v = 1; v <= roll.faces && others.length < 5; v++) if (v !== roll.value) others.push(v);
    while (others.length < 5) others.push(1 + Math.floor(Math.random() * roll.faces));
    return [roll.value, ...others];
  }, [roll.key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const w = wrap.current;
    const c = cube.current;
    const sh = shadow.current;
    if (!w || !c || !sh) return;
    const { from, to, dur } = roll;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    // Trajectoire : lancer en cloche puis deux rebonds sur la table.
    const pts = [
      [0, 0, 0.5], [0.45, -0.25, 1.1], [0.7, 0, 1], [0.82, -0.08, 1.04], [0.92, 0, 1], [0.97, -0.02, 1], [1, 0, 1],
    ];
    const opts = { duration: dur, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" as const };
    const anims = [
      w.animate(pts.map(([k, up, s]) => ({ transform: `translate3d(${from.x + dx * k}px, ${from.y + dy * k + up * 180}px, 0) scale(${s})` })), opts),
      // L'ombre reste au sol : elle suit la même course sans monter, et rétrécit quand le dé est haut.
      sh.animate(pts.map(([k, up]) => ({ transform: `translate3d(${from.x + dx * k}px, ${from.y + dy * k + 34}px, 0) scale(${1 + up * 1.6})`, opacity: 0.8 + up * 2 })), opts),
    ];
    const spinX = 360 * (3 + Math.floor(Math.random() * 2));
    const spinY = 360 * (2 + Math.floor(Math.random() * 2));
    anims.push(c.animate(
      [
        { transform: `rotateX(${Math.random() * 360}deg) rotateY(${Math.random() * 360}deg) rotateZ(20deg)` },
        { transform: `rotateX(${spinX + 25}deg) rotateY(${spinY - 30}deg) rotateZ(-10deg)`, offset: 0.8 },
        { transform: `rotateX(${spinX}deg) rotateY(${spinY}deg) rotateZ(0deg)` },
      ],
      { duration: dur, easing: "cubic-bezier(.15,.6,.25,1)", fill: "forwards" },
    ));
    // Démontage (fin du lancer ou effet interrompu) : on libère les animations 3D, sinon le navigateur peut garder des traces à l'écran.
    return () => anims.forEach((a) => a.cancel());
  }, [roll.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const result = roll.bh
    ? `${BH_SYMBOL[BLACK_HOLES[roll.value - 1]?.id ?? "Primordial"]} ${BLACK_HOLES[roll.value - 1]?.id}`
    : roll.sent ? `🧠 ${roll.value === 1 ? "Vraie" : "Fausse"}` : String(roll.value);
  return (
    <div className="die3d-layer">
      <div ref={shadow} className="die3d-shadow" style={{ transform: `translate3d(${roll.from.x}px, ${roll.from.y + 34}px, 0)` }} />
      <div ref={wrap} className="die3d-pos" style={{ transform: `translate3d(${roll.from.x}px, ${roll.from.y}px, 0)` }}>
        <div ref={cube} className={`die3d ${roll.bh ? "bh" : ""} ${roll.sent ? "sent" : ""}`} style={{ ["--pc" as string]: roll.color }}>
          {/* Noyau opaque : bouche les coins arrondis des faces (sinon on voit à travers le cube). */}
          <span className="die3d-core" />
          <span className="die3d-core" style={{ transform: "rotateY(90deg)" }} />
          <span className="die3d-core" style={{ transform: "rotateX(90deg)" }} />
          {faces.map((v, i) => (
            <span key={i} className={`die3d-face ${i === 0 ? "front" : ""}`} style={{ transform: `${FACE_POS[i]} translateZ(32px)` }}>
              {label(roll, v)}
            </span>
          ))}
        </div>
        {roll.landed && <span className="die3d-impact" style={{ ["--pc" as string]: roll.color }} />}
        {roll.landed && (
          <div className="die3d-result" style={{ color: roll.color }}>
            <span className="die3d-who">{roll.who} · {roll.bh ? "dé trou noir" : roll.sent ? "dé de sentience" : `d${roll.faces}`}</span>
            <span className="die3d-value">{result}</span>
            {!!roll.outcome?.length && (
              <span className="die3d-outcome">{roll.outcome.map((t, i) => <span key={i}>{t}</span>)}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

