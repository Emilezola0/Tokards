export type BlackHole = "Primordial" | "Quasar" | "Blazard" | "Trou de ver";

/** La « météo » est un surnom du trou noir. */
export const BLACK_HOLES: { id: BlackHole; weather: string; icon: string }[] = [
  { id: "Primordial", weather: "Neige", icon: "❄️" },
  { id: "Quasar", weather: "Vent violent", icon: "🌬️" },
  { id: "Blazard", weather: "Pluie", icon: "🌧️" },
  { id: "Trou de ver", weather: "Canicule", icon: "☀️" },
];
/** La météo n'est mentionnée que si le deck Météo est en jeu (info contextuelle). */
let SHOW_WEATHER = true;
export const setShowWeather = (v: boolean) => void (SHOW_WEATHER = v);
export const showWeather = () => SHOW_WEATHER;
export const blackHoleLabel = (b: BlackHole) => {
  const x = BLACK_HOLES.find((h) => h.id === b);
  return x && SHOW_WEATHER ? `${b} (${x.weather})` : b;
};

export type Zone = "deck" | "hand" | "terrain" | "discard";
export const ZONE_LABEL: Record<Zone, string> = {
  deck: "pioche",
  hand: "main",
  terrain: "terrain",
  discard: "défausse",
};

export interface PlayerState {
  gold: number;
  sentience: boolean;
  blackHole: BlackHole;
  /** Règle modifiable par les cartes (ex. Trou de Gold) : les gold peuvent être négatifs. */
  allowNegativeGold: boolean;
  /** deck[0] = dessus de la pioche */
  deck: string[];
  hand: string[];
  terrain: string[];
  discard: string[];
  personalVC: string | null;
  personalDone: boolean;
  /** gold gagnés depuis le début de son dernier tour / pendant le tour d'avant */
  goldGainedSince?: number;
  goldGainedLastTurn?: number;
  /** sentience et trou noir bloqués jusqu'au début de son prochain tour (Poro assassin) */
  locked?: boolean;
  /** compteurs pour les conditions de victoire */
  stats?: { interactions: number; goldMoved: number };
}

export type Prompt = { chooser: string; text: string; cardId?: string } & (
  | { kind: "player"; options: string[] }
  | { kind: "option"; options: string[] }
  | { kind: "number"; min: number; max: number }
  | { kind: "cards"; options: string[]; min: number; max: number; blind?: boolean }
  | { kind: "order"; options: string[] }
);

/** Action en cours de résolution (rejouée depuis l'état d'avant avec les réponses déjà données). */
export type EffectAction =
  | { t: "activate"; by: string }
  | { t: "play"; by: string; card: string; target: string; index: number }
  | { t: "endTurn"; by: string };

export interface Pending {
  action: EffectAction;
  /** réponses déjà données, en JSON (Firestore n'accepte pas les tableaux imbriqués) */
  answers: string[];
  rolls: number[];
  prompt: Prompt;
}

export type Fx =
  | { id: number; k: "activate" | "fail"; card: string; uid: string }
  | { id: number; k: "gold"; uid: string; delta: number }
  | { id: number; k: "sentience"; uid: string; v: boolean }
  | { id: number; k: "bh"; uid: string; to: BlackHole }
  | { id: number; k: "dice"; uid: string; faces: number; value: number }
  | { id: number; k: "move"; card: string }
  | { id: number; k: "banner"; text: string }
  /** annonce du joueur dont c'est le tour */
  | { id: number; k: "turn"; uid: string }
  /** tirage d'une condition de victoire (uid null = condition commune) */
  | { id: number; k: "vc"; uid: string | null; card: string };
export type FxInput = Fx extends infer T ? (T extends Fx ? Omit<T, "id"> : never) : never;

export type Phase = "activation" | "action" | "end";
export type Vote = "continue" | "stop" | "restart";

export interface LogEntry {
  ts: number;
  text: string;
}

export interface GameState {
  order: string[];
  spectators: string[];
  rolls: Record<string, number>;
  turn: number;
  round: number;
  phase: Phase;
  /** cartes déjà activées pendant la phase d'activation de ce tour */
  activated: string[];
  pending: Pending | null;
  fx: Fx[];
  fxSeq: number;
  actionsLeft: number;
  handSize: number;
  players: Record<string, PlayerState>;
  /** propriétaire d'origine de chaque carte (pour savoir dans quelle défausse elle retourne) */
  owner: Record<string, string>;
  commonVC: string;
  vcPile: string[];
  /** équipes ayant rempli la condition commune */
  commonDone: string[];
  ranking: { team: string; round: number }[];
  vote: Record<string, Vote> | null;
  log: LogEntry[];
  /** horodatage du lancement (pour jouer l'animation de mise en place) */
  startedAt?: number;
  /** dernière carte posée ce tour (null = défausse / rien) */
  lastPlayed?: string | null;
}

export interface LobbyPlayer {
  uid: string;
  name: string;
  team: string;
  deck: string | null;
  joinedAt: number;
}

export interface Room {
  code: string;
  hostUid: string;
  /** mode automatique : les cartes scriptées appliquent leur effet toutes seules */
  auto?: boolean;
  status: "lobby" | "playing" | "ended";
  createdAt: number;
  players: Record<string, LobbyPlayer>;
  game: GameState | null;
}
