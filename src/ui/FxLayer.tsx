import { useEffect, useRef, useState } from "react";
import Die3D, { type DieRoll } from "./Die3D";
import { PLACEHOLDER, card, cardImage } from "../data/cards";
import * as E from "../game/engine";
import type { Fx, GameState, Room } from "../game/types";
import { BLACK_HOLES, showWeather } from "../game/types";
import { fxStore } from "./fxStore";
import { css, nearRot, poseOf, poseTransform, q, type Pose } from "./pose";
import { sfx } from "./sfx";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Attend la fin d'une animation, sans jamais bloquer la file si le navigateur la gèle (fenêtre non affichée). */
const done = (a: Animation) => {
  const t = a.effect?.getTiming();
  const ms = Number(t?.duration ?? 0) + Number(t?.delay ?? 0);
  return Promise.race([a.finished.then(() => undefined, () => undefined), wait(ms + 250)]);
};
const EASE = "cubic-bezier(.25,.8,.3,1)";
const CW = 200;
const CH = 300;

function flash(el: HTMLElement | null, cls: string, ms: number) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // relance l'animation
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

function center(): Pose {
  const a = q(".arena")?.getBoundingClientRect();
  const cx = a ? a.left + a.width / 2 : innerWidth / 2;
  const cy = a ? a.top + a.height / 2 : innerHeight / 2;
  return { cx, cy, w: CW, h: CH, rot: 0 };
}

function floatText(at: { x: number; y: number } | null, text: string, cls: string) {
  if (!at) return;
  const el = document.createElement("div");
  el.className = `fx-float ${cls}`;
  el.textContent = text;
  el.style.left = `${at.x}px`;
  el.style.top = `${at.y}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

const mid = (el: HTMLElement | null) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/** Particule qui vole en arc d'un point à un autre. */
function fly(from: { x: number; y: number }, to: { x: number; y: number }, text: string, delay: number, dur: number) {
  const el = document.createElement("div");
  el.className = "fx-particle";
  el.textContent = text;
  document.body.appendChild(el);
  const mx = (from.x + to.x) / 2 + (Math.random() - 0.5) * 160;
  const my = Math.min(from.y, to.y) - 60 - Math.random() * 80;
  const a = el.animate(
    [
      { transform: `translate(${from.x}px, ${from.y}px) translate(-50%,-50%) scale(0.6)`, opacity: 0 },
      { transform: `translate(${mx}px, ${my}px) translate(-50%,-50%) scale(1.3)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${to.x}px, ${to.y}px) translate(-50%,-50%) scale(0.8)`, opacity: 1 },
    ],
    { duration: dur, delay, easing: "ease-in-out", fill: "both" },
  );
  return done(a).then(() => el.remove());
}

type Pt = { x: number; y: number };
async function burst(from: Pt | null, to: Pt | null, text: string, n: number, speed: number, onLand?: (i: number) => void) {
  if (!from || !to) return;
  const all: Promise<void>[] = [];
  // Les pièces partent en rafale : la durée totale reste courte même pour 25 pièces.
  const gap = Math.min(55, 900 / Math.max(1, n)) * speed;
  for (let i = 0; i < n; i++) all.push(fly(from, to, text, i * gap, 650 * speed).then(() => onLand?.(i)));
  await Promise.all(all);
}

/** Flèche animée d'un point à un autre (carte qui agit sur une autre carte). */
function arrow(from: Pt, to: Pt, color: string, speed: number) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "fx-arrow");
  svg.setAttribute("width", String(innerWidth));
  svg.setAttribute("height", String(innerHeight));
  const id = `ah${Math.random().toString(36).slice(2, 8)}`;
  const defs = document.createElementNS(NS, "defs");
  const marker = document.createElementNS(NS, "marker");
  marker.setAttribute("id", id);
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "8");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerWidth", "5");
  marker.setAttribute("markerHeight", "5");
  marker.setAttribute("orient", "auto-start-reverse");
  const tip = document.createElementNS(NS, "path");
  tip.setAttribute("d", "M0,0 L10,5 L0,10 z");
  tip.setAttribute("fill", color);
  marker.append(tip);
  defs.append(marker);
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2 - Math.min(160, Math.hypot(to.x - from.x, to.y - from.y) * 0.3);
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", `M${from.x},${from.y} Q${mx},${my} ${to.x},${to.y}`);
  path.setAttribute("stroke", color);
  path.setAttribute("marker-end", `url(#${id})`);
  svg.append(defs, path);
  document.body.appendChild(svg);
  const len = path.getTotalLength();
  path.style.strokeDasharray = `${len}`;
  const a = path.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 550 * speed, easing: EASE, fill: "forwards" });
  setTimeout(() => svg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, fill: "forwards" }).finished.then(() => svg.remove(), () => svg.remove()), 1500);
  setTimeout(() => svg.remove(), 3000);
  return done(a);
}

/** Petite bulle de résumé posée sur le plateau, près de la carte touchée. */
function bubble(at: Pt | null, text: string, color: string) {
  if (!at) return;
  const el = document.createElement("div");
  el.className = "fx-bubble";
  el.style.left = `${at.x}px`;
  el.style.top = `${at.y}px`;
  el.style.setProperty("--pc", color);
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

const WEATHER: Record<string, string> = { Primordial: "snow", Quasar: "wind", Blazard: "rain", "Trou de ver": "heat" };

function makeCard(id: string, label?: string, text?: string) {
  const el = document.createElement("div");
  el.className = "fx-center-card";
  el.style.width = `${CW}px`;
  el.style.height = `${CH}px`;
  const img = document.createElement("img");
  img.src = cardImage(id);
  img.onerror = () => (img.src = PLACEHOLDER);
  const name = document.createElement("span");
  name.className = "fx-center-name";
  name.textContent = card(id).name;
  el.append(img, name);
  if (label) {
    const l = document.createElement("span");
    l.className = "fx-center-label";
    l.textContent = label;
    el.append(l);
  }
  if (text) {
    const t = document.createElement("span");
    t.className = "fx-center-text";
    t.textContent = text;
    el.append(t);
  }
  q(".fx-layer")?.appendChild(el);
  return el;
}

/** Joue les effets visuels (g.fx) les uns après les autres. */
export default function FxLayer({ g, room, me, fresh, startDelay, colorOf }: {
  g: GameState; room: Room; me: string; fresh: boolean; startDelay: number; colorOf: (uid: string) => string;
}) {
  const seen = useRef<number | null>(null);
  const queue = useRef<Fx[]>([]);
  const playing = useRef(false);
  const prevG = useRef<GameState>(g);
  const gRef = useRef(g);
  gRef.current = g;
  const centerCard = useRef<{ id: string; el: HTMLElement; hidden: HTMLElement | null } | null>(null);
  const [banner, setBanner] = useState<{ text: string; key: number; kind: string } | null>(null);
  const [turn, setTurn] = useState<{ name: string; color: string; key: number; mine: boolean } | null>(null);
  const [die, setDie] = useState<DieRoll | null>(null);
  const [phase, setPhase] = useState<{ n: number; label: string; key: number; color: string; who: string } | null>(null);
  const [win, setWin] = useState<{ name: string; card: string; color: string; key: number; common: boolean } | null>(null);

  useEffect(() => {
    const list = g.fx ?? [];
    const last = list.length ? list[list.length - 1].id : 0;
    if (seen.current === null) {
      // Au chargement on ne rejoue pas l'historique, sauf la mise en place d'une partie qui vient de commencer.
      seen.current = fresh ? 0 : last;
      if (fresh) document.querySelectorAll<HTMLElement>("[data-vc]").forEach((el) => (el.style.opacity = "0"));
    }
    const fresh_ = list.filter((f) => f.id > seen.current!);
    seen.current = Math.max(seen.current, last);
    if (fresh_.length) {
      // Les ressources affichées gardent leur ancienne valeur jusqu'à l'arrivée de l'animation.
      for (const f of fresh_) {
        if (!("uid" in f) || !f.uid) continue;
        const before = prevG.current.players[f.uid];
        if (!before) continue;
        if (f.k === "gold") fxStore.holdIfUnset(f.uid, { gold: before.gold });
        if (f.k === "sentience") fxStore.holdIfUnset(f.uid, { sentience: before.sentience });
        if (f.k === "bh") fxStore.holdIfUnset(f.uid, { bh: before.blackHole });
      }
      queue.current.push(...fresh_);
      if (!playing.current) void play(prevG.current === g && fresh ? startDelay : 380);
    }
    prevG.current = g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g]);

  async function play(delay: number) {
    playing.current = true;
    fxStore.setBusy(true);
    try {
      if (!document.hidden) await wait(delay); // laisse les cartes finir leur déplacement
      while (queue.current.length) {
        const f = queue.current.shift()!;
        const speed = queue.current.length > 14 ? 0.35 : queue.current.length > 6 ? 0.6 : 1;
        try {
          // Onglet en arrière-plan : les animations sont gelées par le navigateur, on applique tout de suite.
          if (document.hidden) instant(f);
          else await step(f, speed);
        } catch (e) {
          console.warn("[fx]", f.k, e);
          dropCenter();
        }
      }
      if (document.hidden) dropCenter();
      else await hideCenter(1);
    } catch (e) {
      console.warn("[fx] fin", e);
      dropCenter();
    } finally {
      fxStore.release();
      playing.current = false;
      fxStore.setBusy(false);
    }
  }

  function dropCenter() {
    const c = centerCard.current;
    if (!c) return;
    centerCard.current = null;
    c.el.remove();
    if (c.hidden) c.hidden.style.opacity = "";
  }

  function instant(f: Fx) {
    dropCenter();
    const held = fxStore.get().held;
    if (f.k === "gold" && held[f.uid]?.gold !== undefined) fxStore.hold(f.uid, { gold: held[f.uid].gold! + f.delta });
    if (f.k === "sentience") fxStore.hold(f.uid, { sentience: f.v });
    if (f.k === "bh") fxStore.hold(f.uid, { bh: f.to });
    if (f.k === "vc") {
      const dest = q(`[data-vc="${css(f.uid ?? "common")}"]`);
      if (dest) dest.style.opacity = "";
    }
  }

  /** Amène la carte au centre de la table. */
  async function showCenter(id: string, speed: number) {
    if (centerCard.current?.id === id) return;
    await hideCenter(speed);
    const src = q(`.arena [data-card="${css(id)}"]`);
    const from = poseOf(src);
    const el = makeCard(id);
    const to = center();
    if (src) src.style.opacity = "0";
    centerCard.current = { id, el, hidden: src };
    await done(el.animate(
      [
        from ? { transform: poseTransform(from, CW, CH), opacity: 1 } : { transform: poseTransform({ ...to, w: CW * 0.3 }, CW, CH), opacity: 0 },
        { transform: poseTransform(to, CW, CH), opacity: 1 },
      ],
      { duration: 420 * speed, easing: EASE, fill: "forwards" },
    ));
  }

  /** Renvoie la carte du centre à sa place (qui a pu changer pendant l'effet). */
  async function hideCenter(speed: number) {
    const c = centerCard.current;
    if (!c) return;
    centerCard.current = null;
    let dest = q(`.arena [data-card="${css(c.id)}"]`);
    if (!dest) {
      const at = E.locate(gRef.current, c.id);
      const pile = at && q(`[data-pile="${css(`${at.zone}:${at.uid}`)}"]`);
      dest = pile?.querySelector<HTMLElement>(".card") ?? pile ?? null;
    }
    const to = poseOf(dest);
    const from = center();
    if (dest?.dataset.card === c.id) dest.style.opacity = "0";
    await done(c.el.animate(
      [
        { transform: poseTransform(from, CW, CH), opacity: 1 },
        to
          ? { transform: poseTransform({ ...to, rot: nearRot(0, to.rot) }, CW, CH), opacity: 1 }
          : { transform: poseTransform({ ...from, w: CW * 0.3 }, CW, CH), opacity: 0 },
      ],
      { duration: 380 * speed, easing: EASE, fill: "forwards" },
    ));
    c.el.remove();
    if (c.hidden) c.hidden.style.opacity = "";
    if (dest) dest.style.opacity = "";
  }

  const centerPoint = () => (centerCard.current ? { x: center().cx, y: center().cy } : null);

  async function step(f: Fx, speed: number) {
    switch (f.k) {
      case "turn": {
        await hideCenter(speed);
        sfx.turn();
        setTurn({ name: E.nameOf(room, f.uid), color: colorOf(f.uid), key: f.id, mine: f.uid === me });
        await wait(1500 * Math.max(speed, 0.6));
        setTurn(null);
        break;
      }
      case "activate": {
        await showCenter(f.card, speed);
        const el = centerCard.current?.el;
        sfx.activate();
        if (el) flash(el, "glow", 900);
        await wait(380 * speed);
        break;
      }
      case "fail": {
        await showCenter(f.card, speed);
        const el = centerCard.current?.el;
        if (el) {
          el.classList.add("fail");
          const stamp = document.createElement("span");
          stamp.className = "fx-stamp";
          stamp.textContent = "✖ Impossible";
          el.appendChild(stamp);
          if (f.reason) {
            const why = document.createElement("span");
            why.className = "fx-center-text fail-why";
            why.textContent = f.reason;
            el.appendChild(why);
          }
        }
        sfx.fail();
        setBanner({ text: `✖ ${card(f.card).name} ne peut pas s'activer${f.reason ? ` : ${f.reason}` : ""}`, key: f.id, kind: "fail" });
        await wait((f.reason ? 1900 : 1000) * Math.max(speed, 0.6));
        break;
      }
      case "gold": {
        const odo = q(`[data-gold="${css(f.uid)}"]`);
        const target = mid(odo);
        const origin = centerPoint() ?? (target ? { x: target.x, y: target.y - 120 } : null);
        // Une pièce par gold, plafonnée à 25.
        const n = Math.max(1, Math.min(25, Math.abs(f.delta)));
        if (f.delta > 0) await burst(origin, target, "🪙", n, speed, (i) => sfx.coin(i));
        else {
          sfx.loss();
          await burst(target, origin, "🪙", n, speed);
        }
        const cur = fxStore.get().held[f.uid]?.gold;
        if (cur !== undefined) fxStore.hold(f.uid, { gold: cur + f.delta });
        flash(odo, f.delta > 0 ? "fx-bump-up" : "fx-bump-down", 600);
        floatText(target, `${f.delta > 0 ? "+" : "−"}${Math.abs(f.delta)} 💰`, f.delta > 0 ? "up" : "down");
        await wait(120 * speed);
        break;
      }
      case "sentience": {
        const el = q(`[data-sent="${css(f.uid)}"]`);
        // Une seule icône : de la carte vers la ressource (gain) ou l'inverse (perte).
        const at = mid(el);
        const from = centerPoint() ?? (at ? { x: at.x, y: at.y - 140 } : null);
        sfx.sentience();
        if (f.v) await burst(from, at, "🧠", 1, speed);
        else await burst(at, from, "🧠", 1, speed);
        fxStore.hold(f.uid, { sentience: f.v });
        flash(el, "fx-pulse", 700);
        floatText(mid(el), f.v ? "🧠 Vraie" : "🧠 Fausse", f.v ? "up" : "down");
        await wait(200 * speed);
        break;
      }
      case "bh": {
        const el = q(`[data-bh="${css(f.uid)}"]`);
        const at = mid(el);
        const from = centerPoint() ?? (at ? { x: at.x, y: at.y - 140 } : null);
        sfx.blackHole();
        await burst(from, at, "🌀", 1, speed);
        fxStore.hold(f.uid, { bh: f.to });
        flash(el, "fx-swirl", 900);
        if (showWeather()) flash(q(`[data-board="${css(f.uid)}"]`), `fx-weather-${WEATHER[f.to] ?? "snow"}`, 1800);
        const b = BLACK_HOLES.find((x) => x.id === f.to);
        floatText(mid(el), `${showWeather() ? b?.icon ?? "🌀" : "🌀"} ${f.to}`, "bh");
        await wait(300 * speed);
        break;
      }
      case "dice": {
        await hideCenter(speed);
        const board = q(`[data-board="${css(f.uid)}"]`);
        const c = center();
        const from = mid(board) ?? { x: c.cx, y: innerHeight - 80 };
        const to = { x: c.cx + (Math.random() - 0.5) * 120, y: c.cy + (Math.random() - 0.5) * 60 };
        const dur = 1200 * Math.max(speed, 0.5);
        sfx.dice();
        const roll: DieRoll = { key: f.id, faces: f.faces, value: f.value, bh: f.bh, who: E.nameOf(room, f.uid), color: colorOf(f.uid), from, to, dur, landed: false };
        setDie(roll);
        await wait(dur);
        sfx.drop();
        setDie({ ...roll, landed: true });
        await wait(1300 * Math.max(speed, 0.6));
        setDie(null);
        break;
      }
      case "vc": {
        await hideCenter(speed);
        const label = f.uid ? `${E.nameOf(room, f.uid)} reçoit` : "Condition commune";
        // On annonce aussi ce qu'il faut faire pour la remplir.
        const el = makeCard(f.card, label, card(f.card).text);
        sfx.vc();
        const c = center();
        await done(el.animate(
          [
            { transform: poseTransform({ ...c, w: CW * 0.2, rot: -20 }, CW, CH), opacity: 0 },
            { transform: poseTransform({ ...c, w: CW * 1.1 }, CW, CH), opacity: 1 },
          ],
          { duration: 450 * speed, easing: EASE, fill: "forwards" },
        ));
        setBanner({ text: `🏁 ${label} : ${card(f.card).name}`, key: f.id, kind: "info" });
        await wait(2600 * Math.max(speed, 0.6));
        const dest = q(`[data-vc="${css(f.uid ?? "common")}"]`);
        const to = poseOf(dest);
        await done(el.animate(
          [
            { transform: poseTransform({ ...c, w: CW * 1.1 }, CW, CH) },
            to ? { transform: poseTransform({ ...to, w: Math.min(to.w, to.h * 0.66) }, CW, CH), opacity: 0.4 } : { opacity: 0 },
          ],
          { duration: 500 * speed, easing: EASE, fill: "forwards" },
        ));
        el.remove();
        if (dest) {
          dest.style.opacity = "";
          flash(dest, "fx-pulse", 700);
        }
        break;
      }
      case "shuffle": {
        // Les cartes de la pile se séparent et se mélangent.
        const pile = q(`[data-pile="${css(`${f.zone}:${f.uid}`)}"]`);
        sfx.shuffle();
        if (pile) {
          const r = pile.getBoundingClientRect();
          const base = pile.querySelector<HTMLElement>(".card");
          const ghosts: Promise<void>[] = [];
          for (let i = 0; i < 6; i++) {
            const gh = (base?.cloneNode(true) as HTMLElement | undefined) ?? document.createElement("div");
            gh.removeAttribute("data-card");
            gh.classList.add("fx-shuffle-card");
            gh.style.width = `${r.width - 4}px`;
            gh.style.left = `${r.left + 2}px`;
            gh.style.top = `${r.top + r.height / 2 - (base?.offsetHeight ?? r.width * 1.5) / 2}px`;
            document.body.appendChild(gh);
            const side = i % 2 ? 1 : -1;
            const a = gh.animate(
              [
                { transform: "translate(0,0) rotate(0deg)" },
                { transform: `translate(${side * (26 + i * 3)}px, ${-8 - i * 2}px) rotate(${side * 14}deg)`, offset: 0.35 },
                { transform: `translate(${-side * 6}px, ${-4}px) rotate(${-side * 4}deg)`, offset: 0.7 },
                { transform: "translate(0,0) rotate(0deg)" },
              ],
              { duration: 700 * Math.max(speed, 0.6), delay: i * 45, easing: "ease-in-out", fill: "both" },
            );
            ghosts.push(done(a).then(() => gh.remove()));
          }
          flash(pile, "fx-pulse", 700);
          await Promise.all(ghosts);
        }
        break;
      }
      case "phase": {
        const n = f.phase === "activation" ? 1 : f.phase === "action" ? 2 : 3;
        const label = f.phase === "activation" ? "Activation du terrain" : f.phase === "action" ? "Poser ou défausser une carte" : "Pioche jusqu'à 4";
        sfx.phase();
        setPhase({ n, label, key: f.id, color: colorOf(f.uid), who: E.nameOf(room, f.uid) });
        await wait(1400 * Math.max(speed, 0.5));
        break;
      }
      case "vcDone": {
        await hideCenter(speed);
        const common = f.card === gRef.current.commonVC;
        sfx.victory();
        setWin({ name: E.nameOf(room, f.uid), card: f.card, color: colorOf(f.uid), key: f.id, common });
        await wait(3200);
        setWin(null);
        flash(q(`[data-vc="${css(common ? "common" : f.uid)}"]`), "fx-pulse", 900);
        break;
      }
      case "link": {
        // Une carte agit sur une autre : flèche de la carte source vers la carte touchée.
        const fromCenter = centerCard.current?.id === f.from;
        const from = fromCenter ? { x: center().cx, y: center().cy } : mid(q(`.arena [data-card="${css(f.from)}"]`));
        let dest = q(`.arena [data-card="${css(f.to)}"]`);
        if (!dest) {
          const at = E.locate(gRef.current, f.to);
          dest = at ? q(`[data-pile="${css(`${at.zone}:${at.uid}`)}"]`) : null;
        }
        const to = mid(dest) ?? mid(f.toUid ? q(`[data-board="${css(f.toUid)}"]`) : null);
        const color = f.toUid ? colorOf(f.toUid) : "#ffd76a";
        sfx.link();
        if (from && to) await arrow(from, to, color, speed);
        if (dest) flash(dest, "fx-linked", 1400);
        bubble(to, `${card(f.from).name} → ${f.text}${f.toUid ? ` · ${E.nameOf(room, f.toUid)}` : ""}`, color);
        await wait(350 * speed);
        break;
      }
      case "banner": {
        setBanner({ text: f.text, key: f.id, kind: "info" });
        await wait(700 * speed);
        break;
      }
      case "move":
        break;
    }
  }

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner((b) => (b?.key === banner.key ? null : b)), 1800);
    return () => clearTimeout(t);
  }, [banner]);

  return (
    <div className="fx-layer">
      {banner && <div key={banner.key} className={`fx-banner ${banner.kind}`}>{banner.text}</div>}
      {turn && (
        <div key={turn.key} className="fx-turn" style={{ ["--pc" as string]: turn.color }}>
          <span className="fx-turn-sub">{turn.mine ? "À toi de jouer" : "Au tour de"}</span>
          <span className="fx-turn-name">{turn.name}</span>
        </div>
      )}
      {phase && (
        <div key={phase.key} className="fx-phase" style={{ ["--pc" as string]: phase.color }} onAnimationEnd={() => setPhase((p) => (p?.key === phase.key ? null : p))}>
          <span className="fx-phase-n">{phase.who} · Phase {phase.n} / 3</span>
          <span className="fx-phase-label">{phase.label}</span>
          <span className="fx-phase-steps">{[1, 2, 3].map((k) => <i key={k} className={k === phase.n ? "on" : k < phase.n ? "past" : ""} />)}</span>
        </div>
      )}
      {win && (
        <div key={win.key} className="fx-win" style={{ ["--pc" as string]: win.color }}>
          <span className="fx-win-sub">🏁 Condition {win.common ? "commune" : "personnelle"} remplie</span>
          <img src={cardImage(win.card)} alt="" onError={(e) => (e.currentTarget.src = PLACEHOLDER)} />
          <span className="fx-win-name">{win.name}</span>
          <span className="fx-win-card">« {card(win.card).name} »</span>
        </div>
      )}
      {die && <Die3D key={die.key} roll={die} />}
    </div>
  );
}
