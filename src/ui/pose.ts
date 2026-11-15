import { DECKS } from "../data/cards";

/** Position affichée d'un élément, même dans un plateau tourné/réduit. */
export type Pose = { cx: number; cy: number; w: number; h: number; rot: number };

export function poseOf(el: Element | null): Pose | null {
  if (!el || !(el instanceof HTMLElement)) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  const board = el.closest<HTMLElement>("[data-rot]");
  const rot = Number(board?.dataset.rot ?? 0);
  const scale = Number(board?.dataset.scale ?? 1);
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: el.offsetWidth * scale, h: el.offsetHeight * scale, rot };
}

/** Transform CSS qui place un élément de taille (w0,h0), positionné en (0,0), sur la pose donnée. */
export function poseTransform(p: Pose, w0: number, h0: number, extraScale = 1) {
  const s = (p.w / w0) * extraScale;
  return `translate(${p.cx - w0 / 2}px, ${p.cy - h0 / 2}px) rotate(${p.rot}deg) scale(${s})`;
}

export const q = (sel: string) => document.querySelector<HTMLElement>(sel);
export const css = (v: string) => CSS.escape(v);

/** Plus court chemin angulaire, pour qu'une carte ne fasse pas un tour complet. */
export function nearRot(from: number, to: number) {
  let d = ((to - from) % 360 + 540) % 360 - 180;
  return from + d;
}

export const PLAYER_COLORS = ["#ff6b8a", "#5ab8ff", "#5ee0a0", "#ffcf5a", "#c38bff", "#ff9a3c", "#4de0d6", "#f78fd8"];

/** Couleur d'un deck : celle du tableau si renseignée, sinon une teinte dérivée du nom. */
export function deckColor(name: string): string {
  const d = DECKS.find((x) => x.name === name);
  if (d?.color && /^#?[0-9a-f]{6}$/i.test(d.color)) return d.color.startsWith("#") ? d.color : `#${d.color}`;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 42%)`;
}
