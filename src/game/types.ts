export type BlackHole = "Primordial" | "Quasar" | "Blazard" | "Trou de ver";

/** La « météo » est un surnom du trou noir. */
export const BLACK_HOLES: { id: BlackHole; weather: string; icon: string }[] = [
  { id: "Primordial", weather: "Neige", icon: "❄️" },
  { id: "Quasar", weather: "Vent violent", icon: "🌬️" },
  { id: "Blazard", weather: "Pluie", icon: "🌧️" },
  { id: "Trou de ver", weather: "Canicule", icon: "☀️" },
];
export const blackHoleLabel = (b: BlackHole) => {
  const x = BLACK_HOLES.find((h) => h.id === b);
  return x ? `${b} (${x.weather})` : b;
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
}

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
  activationIndex: number;
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
  status: "lobby" | "playing" | "ended";
  createdAt: number;
  players: Record<string, LobbyPlayer>;
  game: GameState | null;
}
