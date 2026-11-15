import { useEffect, useRef, useState } from "react";
import { card } from "../data/cards";
import * as E from "../game/engine";
import type { Fx, GameState, Room } from "../game/types";
import { BLACK_HOLES } from "../game/types";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const css = (v: string) => CSS.escape(v);

function flash(el: HTMLElement | null, cls: string, ms: number) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // relance l'animation
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

function floatText(anchor: HTMLElement | null, text: string, cls: string) {
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = `fx-float ${cls}`;
  el.textContent = text;
  el.style.left = `${r.left + r.width / 2}px`;
  el.style.top = `${r.top}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

function coins(from: HTMLElement | null, n: number) {
  if (!from) return;
  const r = from.getBoundingClientRect();
  for (let i = 0; i < Math.min(8, Math.max(3, Math.round(n / 5))); i++) {
    const c = document.createElement("div");
    c.className = "fx-coin";
    c.textContent = "🪙";
    c.style.left = `${r.left + r.width / 2}px`;
    c.style.top = `${r.top + r.height / 2}px`;
    c.style.setProperty("--dx", `${(Math.random() - 0.5) * 120}px`);
    c.style.setProperty("--dy", `${-40 - Math.random() * 60}px`);
    c.style.animationDelay = `${i * 40}ms`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 1200);
  }
}

const WEATHER: Record<string, string> = { Primordial: "snow", Quasar: "wind", Blazard: "rain", "Trou de ver": "heat" };

/** Joue les effets visuels (g.fx) les uns après les autres. */
export default function FxLayer({ g, room }: { g: GameState; room: Room }) {
  const seen = useRef<number | null>(null);
  const queue = useRef<Fx[]>([]);
  const playing = useRef(false);
  const [banner, setBanner] = useState<{ text: string; key: number; kind: string } | null>(null);
  const [die, setDie] = useState<{ faces: number; value: number; shown: number; who: string } | null>(null);

  useEffect(() => {
    const list = g.fx ?? [];
    const last = list.length ? list[list.length - 1].id : 0;
    // Au chargement, on ne rejoue pas l'historique.
    if (seen.current === null) {
      seen.current = last;
      return;
    }
    const fresh = list.filter((f) => f.id > seen.current!);
    seen.current = Math.max(seen.current, last);
    if (!fresh.length) return;
    queue.current.push(...fresh);
    if (!playing.current) void play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.fxSeq]);

  async function play() {
    playing.current = true;
    while (queue.current.length) {
      const f = queue.current.shift()!;
      // Si beaucoup d'effets s'accumulent, on accélère.
      const speed = queue.current.length > 12 ? 0.35 : queue.current.length > 5 ? 0.6 : 1;
      await step(f, speed);
    }
    playing.current = false;
  }

  async function step(f: Fx, speed: number) {
    switch (f.k) {
      case "activate": {
        flash(q(`[data-card="${css(f.card)}"]`), "fx-activate", 1100);
        setBanner({ text: `✨ ${card(f.card).name}`, key: f.id, kind: "act" });
        await wait(750 * speed);
        break;
      }
      case "fail": {
        flash(q(`[data-card="${css(f.card)}"]`), "fx-fail", 600);
        setBanner({ text: `✖ ${card(f.card).name} : impossible`, key: f.id, kind: "fail" });
        await wait(500 * speed);
        break;
      }
      case "gold": {
        const el = q(`[data-gold="${css(f.uid)}"]`);
        flash(el, f.delta > 0 ? "fx-bump-up" : "fx-bump-down", 600);
        floatText(el, `${f.delta > 0 ? "+" : "−"}${Math.abs(f.delta)} 💰`, f.delta > 0 ? "up" : "down");
        if (f.delta > 0) coins(el, f.delta);
        await wait(380 * speed);
        break;
      }
      case "sentience": {
        const el = q(`[data-sent="${css(f.uid)}"]`);
        flash(el, "fx-pulse", 700);
        floatText(el, f.v ? "🧠 Vraie" : "🧠 Fausse", f.v ? "up" : "down");
        await wait(380 * speed);
        break;
      }
      case "bh": {
        const el = q(`[data-bh="${css(f.uid)}"]`);
        flash(el, "fx-swirl", 900);
        const board = q(`[data-board="${css(f.uid)}"]`);
        flash(board, `fx-weather-${WEATHER[f.to] ?? "snow"}`, 1800);
        const b = BLACK_HOLES.find((x) => x.id === f.to);
        floatText(el, `${b?.icon ?? "🌀"} ${f.to}`, "bh");
        await wait(550 * speed);
        break;
      }
      case "dice": {
        const who = E.nameOf(room, f.uid);
        for (let i = 0; i < 7; i++) {
          setDie({ faces: f.faces, value: f.value, shown: 1 + Math.floor(Math.random() * f.faces), who });
          await wait(60 * speed);
        }
        setDie({ faces: f.faces, value: f.value, shown: f.value, who });
        await wait(700 * speed);
        setDie(null);
        break;
      }
      case "move": {
        flash(q(`[data-card="${css(f.card)}"]`), "fx-arrive", 500);
        await wait(140 * speed);
        break;
      }
      case "banner": {
        setBanner({ text: f.text, key: f.id, kind: "info" });
        await wait(700 * speed);
        break;
      }
    }
  }

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner((b) => (b?.key === banner.key ? null : b)), 1600);
    return () => clearTimeout(t);
  }, [banner]);

  return (
    <>
      {banner && <div key={banner.key} className={`fx-banner ${banner.kind}`}>{banner.text}</div>}
      {die && (
        <div className="fx-die-wrap">
          <div className={`fx-die ${die.shown === die.value ? "final" : ""}`}>{die.shown}</div>
          <div className="small">{die.who} · d{die.faces}</div>
        </div>
      )}
    </>
  );
}
