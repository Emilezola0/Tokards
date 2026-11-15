// Effets sonores synthétisés (Web Audio) : aucun fichier à télécharger.
import { useSyncExternalStore } from "react";

const KEY = "tokards.muted";
const VKEY = "tokards.volume";
let volume = (() => {
  try {
    const v = Number(localStorage.getItem(VKEY));
    return Number.isFinite(v) && localStorage.getItem(VKEY) !== null ? Math.max(0, Math.min(1, v)) : 0.7;
  } catch {
    return 0.7;
  }
})();
let muted = (() => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
})();
const subs = new Set<() => void>();
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ac() {
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = 0.5 * volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}
// Les navigateurs n'autorisent le son qu'après une action de l'utilisateur.
addEventListener("pointerdown", () => ac(), { once: true });

export function setMuted(v: boolean) {
  muted = v;
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {
    /* stockage indisponible */
  }
  subs.forEach((f) => f());
}
/** Volume de 0 à 1 (retenu dans le navigateur). */
export function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = 0.5 * volume;
  try {
    localStorage.setItem(VKEY, String(volume));
  } catch {
    /* stockage indisponible */
  }
  subs.forEach((f) => f());
}
export const useVolume = () =>
  useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => volume);
export const useMuted = () =>
  useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => muted);

type Tone = { f: number; to?: number; t?: number; d: number; type?: OscillatorType; v?: number };
function tones(list: Tone[]) {
  if (muted || !volume || document.hidden) return;
  const a = ac();
  if (!a || !master || a.state !== "running") return;
  const now = a.currentTime;
  for (const { f, to, t = 0, d, type = "sine", v = 0.5 } of list) {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, now + t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, now + t + d);
    g.gain.setValueAtTime(0.0001, now + t);
    g.gain.exponentialRampToValueAtTime(v, now + t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + t + d);
    o.connect(g).connect(master);
    o.start(now + t);
    o.stop(now + t + d + 0.02);
  }
}
function noise(d: number, v = 0.3, hp = 1200, t = 0) {
  if (muted || document.hidden) return;
  const a = ac();
  if (!a || !master || a.state !== "running") return;
  const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * d)), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = hp;
  const g = a.createGain();
  g.gain.value = v;
  src.connect(f).connect(g).connect(master);
  src.start(a.currentTime + t);
}

let lastCard = 0;
export const sfx = {
  /** carte qui glisse */
  card() {
    const n = performance.now();
    if (n - lastCard < 45) return;
    lastCard = n;
    noise(0.12, 0.18, 2500);
  },
  pick: () => tones([{ f: 520, to: 700, d: 0.07, type: "triangle", v: 0.25 }]),
  drop: () => (noise(0.08, 0.25, 600), tones([{ f: 180, to: 120, d: 0.1, type: "sine", v: 0.4 }])),
  coin: (i = 0) => tones([{ f: 1800 + (i % 5) * 140, d: 0.09, type: "square", v: 0.06 }, { f: 2600 + (i % 3) * 200, t: 0.03, d: 0.12, type: "sine", v: 0.12 }]),
  loss: () => tones([{ f: 420, to: 220, d: 0.18, type: "triangle", v: 0.25 }]),
  activate: () => tones([{ f: 660, d: 0.18, type: "triangle", v: 0.25 }, { f: 990, t: 0.08, d: 0.25, type: "sine", v: 0.2 }, { f: 1320, t: 0.16, d: 0.3, type: "sine", v: 0.12 }]),
  fail: () => tones([{ f: 160, to: 90, d: 0.35, type: "sawtooth", v: 0.18 }, { f: 120, t: 0.12, to: 70, d: 0.3, type: "square", v: 0.08 }]),
  sentience: () => tones([{ f: 440, to: 880, d: 0.25, type: "sine", v: 0.25 }]),
  blackHole: () => (tones([{ f: 300, to: 60, d: 0.6, type: "sine", v: 0.35 }]), noise(0.5, 0.12, 300)),
  turn: () => tones([{ f: 392, d: 0.5, type: "triangle", v: 0.3 }, { f: 587, t: 0.12, d: 0.6, type: "triangle", v: 0.25 }]),
  phase: () => tones([{ f: 740, d: 0.12, type: "sine", v: 0.15 }, { f: 988, t: 0.07, d: 0.16, type: "sine", v: 0.12 }]),
  dice: () => { for (let i = 0; i < 5; i++) noise(0.04, 0.2, 1800, i * 0.07); },
  link: () => tones([{ f: 900, to: 1500, d: 0.2, type: "sine", v: 0.15 }]),
  vc: () => tones([{ f: 523, d: 0.2, type: "triangle", v: 0.25 }, { f: 659, t: 0.15, d: 0.2, type: "triangle", v: 0.25 }, { f: 784, t: 0.3, d: 0.4, type: "triangle", v: 0.25 }]),
  victory: () => tones([523, 659, 784, 1047, 784, 1047].map((f, i) => ({ f, t: i * 0.13, d: 0.3, type: "triangle" as const, v: 0.3 }))),
  shuffle: () => { for (let i = 0; i < 9; i++) noise(0.05, 0.16, 2200 + (i % 3) * 400, i * 0.06); },
  click: () => tones([{ f: 1200, d: 0.03, type: "square", v: 0.05 }]),
};
