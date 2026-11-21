// Voicelines des cartes : un fichier par carte dans src/assets/voices/<ID>.mp3 (ou .ogg / .wav / .m4a / .webm).
// Une carte sans fichier ne joue rien. Au plus 2 voicelines en même temps : la plus ancienne et la plus faible s'arrête.
import { useSyncExternalStore } from "react";
import { CARDS } from "../data/cards";
import { isMuted } from "./sfx";

const FILES = import.meta.glob("../assets/voices/*.{mp3,ogg,wav,m4a,webm}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const URLS: Record<string, string> = {};
for (const [path, url] of Object.entries(FILES)) {
  const id = path.split("/").pop()!.replace(/\.[^.]+$/, "");
  URLS[id] = url;
}

const KEY = "tokards.voiceVolume";
/** Volumes réglés par deck et par carte (0 à 1, 1 par défaut), gardés dans ce navigateur. */
const KEY_EACH = "tokards.voiceVolumeEach";
let each: Record<string, number> = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY_EACH) ?? "{}") ?? {};
  } catch {
    return {};
  }
})();
const MAX = 2;
let volume = (() => {
  try {
    const v = localStorage.getItem(KEY);
    return v !== null && Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : 0.8;
  } catch {
    return 0.8;
  }
})();
const subs = new Set<() => void>();
const playing: { el: HTMLAudioElement; at: number; gain: number }[] = [];

export const hasVoice = (id: string) => !!URLS[id];
export const voiceCount = () => Object.keys(URLS).length;

export function setVoiceVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  for (const p of playing) p.el.volume = p.gain * volume;
  try {
    localStorage.setItem(KEY, String(volume));
  } catch {
    /* stockage indisponible */
  }
  subs.forEach((f) => f());
}
export const useVoiceVolume = () => useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => volume);

/** Volume propre à un deck (`deck:<nom>`) ou à une carte (`<ID>`). */
export const eachVolume = (key: string) => each[key] ?? 1;
export function setEachVolume(key: string, v: number) {
  each = { ...each, [key]: Math.max(0, Math.min(1, v)) };
  if (each[key] === 1) delete each[key];
  try {
    localStorage.setItem(KEY_EACH, JSON.stringify(each));
  } catch {
    /* stockage indisponible */
  }
  subs.forEach((f) => f());
}
export const useEachVolume = (key: string) => useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => eachVolume(key));
/** Volume final d'une carte : celui de son deck × le sien. */
const cardVolume = (id: string) => eachVolume(`deck:${CARDS[id]?.deck ?? ""}`) * eachVolume(id);
/** Variation de ±10 % (volume et hauteur) à chaque lecture, pour que la même voix ne sonne jamais pareil. */
const jitter = () => 0.9 + Math.random() * 0.2;

function drop(p: (typeof playing)[number]) {
  p.el.pause();
  const i = playing.indexOf(p);
  if (i >= 0) playing.splice(i, 1);
}

/** Vitesse de lecture d'une carte qui subit un effet (voix 30 % plus grave). */
export const HURT_RATE = 0.7;

/**
 * Joue la voiceline de la carte `id` (rien si elle n'en a pas). `gain` : 0 à 1, relatif au curseur.
 * `rate` : vitesse de lecture ; HURT_RATE = voix plus grave (carte qui subit un effet).
 */
export function playVoice(id: string, gain = 1, rate = 1) {
  const url = URLS[id];
  if (!url || isMuted() || !volume || document.hidden) return;
  gain = Math.min(1, gain * cardVolume(id) * jitter());
  rate *= jitter();
  if (!gain) return;
  if (playing.length >= MAX) {
    // La plus faible en volume, puis la plus ancienne, laisse sa place.
    const victim = [...playing].sort((a, b) => a.gain - b.gain || a.at - b.at)[0];
    drop(victim);
  }
  const el = new Audio(url);
  const p = { el, at: performance.now(), gain };
  el.volume = gain * volume;
  // La hauteur suit la vitesse (sinon le navigateur garde la même hauteur).
  el.preservesPitch = false;
  el.playbackRate = rate;
  el.onended = () => drop(p);
  el.onerror = () => drop(p);
  playing.push(p);
  if (FADE_DECKS.has(CARDS[id]?.deck ?? "")) fade(el, gain * volume);
  void el.play().catch(() => drop(p));
}

/** Decks dont les voicelines démarrent et finissent en fondu rapide (sons coupés net à l'enregistrement). */
const FADE_DECKS = new Set(["Météo"]);
const FADE_MS = 120;
/** Fondu d'entrée puis de sortie rapide sur le volume (sans Web Audio). */
function fade(el: HTMLAudioElement, target: number) {
  el.volume = 0;
  const tick = () => {
    if (el.paused && el.currentTime > 0) return;
    const d = el.duration;
    const t = el.currentTime * 1000;
    const left = Number.isFinite(d) ? (d - el.currentTime) * 1000 / (el.playbackRate || 1) : Infinity;
    const k = Math.min(1, t / FADE_MS / (el.playbackRate || 1), left / FADE_MS);
    el.volume = Math.max(0, Math.min(1, target * k));
    if (!el.ended) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Joue la voiceline d'une carte au hasard du deck (choix du deck dans le salon). */
export function playDeckVoice(deck: string) {
  const ids = Object.values(CARDS).filter((c) => c.deck === deck && URLS[c.id]).map((c) => c.id);
  if (ids.length) playVoice(ids[Math.floor(Math.random() * ids.length)]);
}
