import { useEffect, useRef, useState } from "react";
import { PLACEHOLDER, card, cardImage } from "../data/cards";
import * as E from "../game/engine";
import type { Fx, GameState, Room } from "../game/types";
import { BLACK_HOLES, showWeather } from "../game/types";
import { fxStore } from "./fxStore";
import { css, nearRot, poseOf, poseTransform, q, type Pose } from "./pose";

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

async function burst(from: { x: number; y: number } | null, to: { x: number; y: number } | null, text: string, n: number, speed: number) {
  if (!from || !to) return;
  const all: Promise<void>[] = [];
  for (let i = 0; i < n; i++) all.push(fly(from, to, text, i * 55 * speed, 650 * speed));
  await Promise.all(all);
}

const WEATHER: Record<string, string> = { Primordial: "snow", Quasar: "wind", Blazard: "rain", "Trou de ver": "heat" };

function makeCard(id: string, label?: string) {
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
  const [die, setDie] = useState<{ faces: number; value: number; shown: number; who: string; color: string } | null>(null);

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
        setTurn({ name: E.nameOf(room, f.uid), color: colorOf(f.uid), key: f.id, mine: f.uid === me });
        await wait(1500 * Math.max(speed, 0.6));
        setTurn(null);
        break;
      }
      case "activate": {
        await showCenter(f.card, speed);
        const el = centerCard.current?.el;
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
        }
        setBanner({ text: `✖ ${card(f.card).name} ne peut pas s'activer`, key: f.id, kind: "fail" });
        await wait(1000 * Math.max(speed, 0.6));
        break;
      }
      case "gold": {
        const odo = q(`[data-gold="${css(f.uid)}"]`);
        const target = mid(odo);
        const origin = centerPoint() ?? (target ? { x: target.x, y: target.y - 120 } : null);
        const n = Math.max(3, Math.min(10, Math.round(Math.abs(f.delta) / 3)));
        if (f.delta > 0) await burst(origin, target, "🪙", n, speed);
        else await burst(target, origin, "🪙", n, speed);
        const cur = fxStore.get().held[f.uid]?.gold;
        if (cur !== undefined) fxStore.hold(f.uid, { gold: cur + f.delta });
        flash(odo, f.delta > 0 ? "fx-bump-up" : "fx-bump-down", 600);
        floatText(target, `${f.delta > 0 ? "+" : "−"}${Math.abs(f.delta)} 💰`, f.delta > 0 ? "up" : "down");
        await wait(120 * speed);
        break;
      }
      case "sentience": {
        const el = q(`[data-sent="${css(f.uid)}"]`);
        await burst(centerPoint(), mid(el), "🧠", 3, speed);
        fxStore.hold(f.uid, { sentience: f.v });
        flash(el, "fx-pulse", 700);
        floatText(mid(el), f.v ? "🧠 Vraie" : "🧠 Fausse", f.v ? "up" : "down");
        await wait(200 * speed);
        break;
      }
      case "bh": {
        const el = q(`[data-bh="${css(f.uid)}"]`);
        await burst(centerPoint(), mid(el), "🌀", 3, speed);
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
        const who = E.nameOf(room, f.uid);
        const color = colorOf(f.uid);
        for (let i = 0; i < 7; i++) {
          setDie({ faces: f.faces, value: f.value, shown: 1 + Math.floor(Math.random() * f.faces), who, color });
          await wait(60 * speed);
        }
        setDie({ faces: f.faces, value: f.value, shown: f.value, who, color });
        await wait(800 * speed);
        setDie(null);
        break;
      }
      case "vc": {
        await hideCenter(speed);
        const label = f.uid ? `${E.nameOf(room, f.uid)} reçoit` : "Condition commune";
        const el = makeCard(f.card, label);
        const c = center();
        await done(el.animate(
          [
            { transform: poseTransform({ ...c, w: CW * 0.2, rot: -20 }, CW, CH), opacity: 0 },
            { transform: poseTransform({ ...c, w: CW * 1.1 }, CW, CH), opacity: 1 },
          ],
          { duration: 450 * speed, easing: EASE, fill: "forwards" },
        ));
        setBanner({ text: `🏁 ${label} : ${card(f.card).name}`, key: f.id, kind: "info" });
        await wait(1300 * speed);
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
      {die && (
        <div className="fx-die-wrap">
          <div className={`fx-die ${die.shown === die.value ? "final" : ""}`} style={{ ["--pc" as string]: die.color }}>{die.shown}</div>
          <div className="fx-die-who" style={{ color: die.color }}>{die.who} · d{die.faces}</div>
        </div>
      )}
    </div>
  );
}
