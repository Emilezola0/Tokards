import { useSyncExternalStore } from "react";
import type { BlackHole } from "../game/types";

/**
 * Valeurs « retenues » pendant les animations : la ressource affichée n'évolue qu'au moment où
 * l'animation correspondante arrive (les gold s'ajoutent quand les pièces atterrissent).
 */
export type Held = { gold?: number; sentience?: boolean; bh?: BlackHole };
type State = { busy: boolean; held: Record<string, Held> };

let state: State = { busy: false, held: {} };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const fxStore = {
  get: () => state,
  isBusy: () => state.busy,
  setBusy(busy: boolean) {
    if (busy === state.busy) return;
    state = { ...state, busy };
    emit();
  },
  hold(uid: string, h: Held) {
    state = { ...state, held: { ...state.held, [uid]: { ...state.held[uid], ...h } } };
    emit();
  },
  holdIfUnset(uid: string, h: Held) {
    const cur = state.held[uid] ?? {};
    const add: Held = {};
    for (const k of Object.keys(h) as (keyof Held)[]) if (cur[k] === undefined) (add as Record<string, unknown>)[k] = h[k];
    if (Object.keys(add).length) this.hold(uid, add);
  },
  release() {
    state = { ...state, held: {} };
    emit();
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => void subs.delete(f);
  },
};

export const useFx = () => useSyncExternalStore(fxStore.subscribe, fxStore.get);
