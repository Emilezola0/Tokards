import { useLayoutEffect, useRef } from "react";
import type { GameState, Zone } from "../game/types";
import { nearRot, poseOf, poseTransform, type Pose } from "./pose";
import { sfx } from "./sfx";

type Loc = { uid: string; zone: Zone; i: number };
type Seen = { pose: Pose; el: HTMLElement };

function indexCards(g: GameState) {
  const m = new Map<string, Loc>();
  for (const [uid, p] of Object.entries(g.players))
    for (const zone of ["deck", "hand", "terrain", "discard"] as Zone[]) p[zone].forEach((id, i) => m.set(id, { uid, zone, i }));
  return m;
}

function scan(root: HTMLElement) {
  const cards = new Map<string, Seen>();
  root.querySelectorAll<HTMLElement>("[data-board] [data-card]").forEach((el) => {
    const pose = poseOf(el);
    if (pose) cards.set(el.dataset.card!, { pose, el });
  });
  const piles = new Map<string, Seen>();
  root.querySelectorAll<HTMLElement>("[data-pile]").forEach((wrap) => {
    const el = wrap.querySelector<HTMLElement>(".card") ?? wrap;
    const pose = poseOf(el);
    if (pose) piles.set(wrap.dataset.pile!, { pose, el });
  });
  return { cards, piles };
}

const visible = (l: Loc) => l.zone === "hand" || l.zone === "terrain" || (l.zone === "discard" && l.i === 0);

let layer: HTMLElement | null = null;
function ghostLayer() {
  if (!layer || !layer.isConnected) {
    layer = document.createElement("div");
    layer.className = "ghost-layer";
    document.body.appendChild(layer);
  }
  return layer;
}

/** Fait voler une copie de `src` de la pose `from` à la pose `to`, en masquant `hide` pendant le vol. */
export function flyGhost(src: HTMLElement, from: Pose, to: Pose, delay = 0, hide?: HTMLElement | null, duration = 480) {
  const w0 = src.offsetWidth || 72;
  const h0 = src.offsetHeight || 108;
  const gh = src.cloneNode(true) as HTMLElement;
  gh.removeAttribute("data-card");
  gh.classList.remove("selected", "highlight", "target");
  gh.classList.add("flip-ghost");
  gh.style.width = `${w0}px`;
  gh.style.height = `${h0}px`;
  gh.style.opacity = "";
  ghostLayer().appendChild(gh);
  const toPose = { ...to, rot: nearRot(from.rot, to.rot) };
  const midScale = 1.12;
  setTimeout(() => sfx.card(), delay);
  const anim = gh.animate(
    [
      { transform: poseTransform(from, w0, h0) },
      { transform: poseTransform({ ...toPose, cx: (from.cx + to.cx) / 2, cy: (from.cy + to.cy) / 2 - 30 }, w0, h0, midScale), offset: 0.5 },
      { transform: poseTransform(toPose, w0, h0) },
    ],
    { duration, delay, easing: "cubic-bezier(.25,.8,.3,1)", fill: "both" },
  );
  if (hide) hide.style.opacity = "0";
  const done = () => {
    gh.remove();
    if (hide) hide.style.opacity = "";
  };
  anim.onfinish = done;
  anim.oncancel = done;
  setTimeout(done, delay + duration + 300); // si le navigateur gèle l'animation
}

/**
 * Anime chaque changement de position de carte (FLIP) : on compare l'état précédent et le nouveau,
 * et on fait voler une copie de la carte de son ancienne place (ou de la pile) vers la nouvelle.
 */
export function useCardFlip(root: React.RefObject<HTMLElement | null>, g: GameState, fresh: boolean) {
  const prevG = useRef<GameState | null>(null);
  const last = useRef<ReturnType<typeof scan> | null>(null);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const now = scan(el);
    const prev = prevG.current;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!reduce && prev && prev !== g && last.current) {
      const before = indexCards(prev);
      const after = indexCards(g);
      let k = 0;
      for (const [id, loc] of after) {
        const old = before.get(id);
        if (!old) continue;
        const sameZone = old.uid === loc.uid && old.zone === loc.zone;
        if (sameZone && (old.i === loc.i || loc.zone === "deck" || loc.zone === "discard")) continue;
        const from = visible(old) ? last.current.cards.get(id)?.pose ?? last.current.piles.get(`${old.zone}:${old.uid}`)?.pose : last.current.piles.get(`${old.zone}:${old.uid}`)?.pose;
        const dest = visible(loc) ? now.cards.get(id) : undefined;
        const pile = now.piles.get(`${loc.zone}:${loc.uid}`);
        const to = dest?.pose ?? pile?.pose;
        const src = dest?.el ?? pile?.el;
        if (!from || !to || !src) continue;
        if (Math.hypot(from.cx - to.cx, from.cy - to.cy) < 3 && from.rot === to.rot) continue;
        flyGhost(src, from, to, Math.min(k++ * 70, 700), dest?.el);
      }
    } else if (!reduce && !prev && fresh) {
      // Distribution : les mains arrivent depuis les pioches, une carte à la fois, en tournant.
      const order = g.order;
      order.forEach((uid, j) => {
        const deck = now.piles.get(`deck:${uid}`)?.pose;
        g.players[uid].hand.forEach((id, i) => {
          const c = now.cards.get(id);
          if (deck && c) flyGhost(c.el, deck, c.pose, 300 + (i * order.length + j) * 110, c.el, 520);
        });
      });
    }
    prevG.current = g;
    last.current = now;
  });
}

export const dealDuration = (g: GameState) => 300 + g.handSize * g.order.length * 110 + 600;
