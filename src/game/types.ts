export type BlackHole = "Primordial" | "Quasar" | "Blazard" | "Trou de ver";

/** La « météo » est un surnom du trou noir. */
export const BLACK_HOLES: { id: BlackHole; weather: string; icon: string }[] = [
  { id: "Primordial", weather: "Grêle", icon: "🌨️" },
  { id: "Quasar", weather: "Vent violent", icon: "🌬️" },
  { id: "Blazard", weather: "Pluie", icon: "🌧️" },
  { id: "Trou de ver", weather: "Canicule", icon: "☀️" },
];
/** Météo d'un joueur (deck Météo) : un état à part du trou noir. null = Beau temps. */
export type Weather = "Pluie" | "Vent violent" | "Canicule" | "Neige" | "Grêle" | "Orage";
export const WEATHERS: { id: Weather; icon: string; fx: string }[] = [
  { id: "Pluie", icon: "🌧️", fx: "rain" },
  { id: "Vent violent", icon: "🌬️", fx: "wind" },
  { id: "Canicule", icon: "☀️", fx: "heat" },
  { id: "Neige", icon: "❄️", fx: "snow" },
  { id: "Grêle", icon: "🌨️", fx: "hail" },
  { id: "Orage", icon: "⛈️", fx: "storm" },
];
export const weatherIcon = (w: Weather | null | undefined) => WEATHERS.find((x) => x.id === w)?.icon ?? "🌤️";
export const weatherLabel = (w: Weather | null | undefined) => w ?? "Beau temps";
/** Météo correspondant à chaque trou noir (carte « Météo »). */
export const BH_WEATHER: Record<BlackHole, Weather> = { Blazard: "Pluie", Quasar: "Vent violent", "Trou de ver": "Canicule", Primordial: "Grêle" };
/** Symbole de chaque état sur le dé trou noir et dans le glossaire. */
export const BH_SYMBOL: Record<BlackHole, string> = { Primordial: "🌑", Quasar: "✴️", Blazard: "🔥", "Trou de ver": "🕳️" };
/** La météo n'est mentionnée que si le deck Météo est en jeu (info contextuelle). */
let SHOW_WEATHER = true;
export const setShowWeather = (v: boolean) => void (SHOW_WEATHER = v);
export const showWeather = () => SHOW_WEATHER;
export const blackHoleLabel = (b: BlackHole) => b;

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
  stats?: Stats;
  /** a abandonné la partie : ses tours sont passés */
  out?: boolean;
  /** ne peut pas poser de carte ce tour (raison affichée) / au prochain tour */
  cantPlay?: string;
  cantPlayNext?: string;
  /** son prochain tour est passé (Thommage) */
  skipNext?: boolean;
  /** météo (deck Météo) ; absente ou null = Beau temps */
  weather?: Weather | null;
  /** Météo étrange : 2e météo, gardée jusqu'au prochain changement de trou noir */
  weather2?: Weather | null;
}

/** Fin d'un état temporaire : au début (`start`) ou à la fin (`end`) d'un tour de `uid` joué après le tour global `after`. */
export type Until = { uid: string; edge: "start" | "end"; after: number };

/** Compteurs suivis pendant la partie pour vérifier les conditions de victoire. */
export interface Stats {
  interactions?: number;
  /** interactions dont la cible est un autre joueur */
  interOthers?: number;
  /** joueurs avec qui on a eu au moins une interaction */
  met?: string[];
  goldMoved?: number;
  spent?: number;
  lost?: number;
  /** changements de son trou noir pendant son tour en cours */
  bhTurn?: number;
  /** changements de météo pendant son tour (Météo Rite) */
  wxTurn?: number;
  /** gold gagnés depuis le dernier changement de trou noir de ce tour (null = pas encore de changement) */
  gainSinceBH?: number | null;
  bhGainHit?: boolean;
  turnsPlayed?: number;
  /** ses cartes activées pendant le tour d'un autre */
  offTurn?: number;
  /** ses cartes qui n'ont pas pu s'activer pendant sa phase 1 */
  failed?: number;
  /** cartes d'autres joueurs touchées, rangées par tag */
  cardTags?: { s: string[]; g: string[]; b: string[] };
  /** historique des trous noirs (pos = numéro de tour global) */
  bhHist?: { pos: number; bh: BlackHole }[];
  /** début de la série « strictement le plus riche » */
  richSince?: number | null;
  /** gold dépensés / perdus pendant son tour en cours */
  spentTurn?: number;
  lostTurn?: number;
  /** cartes d'autres joueurs défaussées par ses effets (Guerre civile) */
  discOthers?: number;
  /** cartes de sa main / de son terrain parties dans une défausse (Pirate) */
  handDisc?: number;
  terrDisc?: number;
  /** changements de sa sentience (Rêverie) */
  sentFlips?: number;
  /** gold donnés à d'autres joueurs (hors vols) — Dette public */
  given?: number;
  /** interactions avec chaque autre joueur (Racoon) */
  metN?: Record<string, number>;
  /** début de la série « terrain vide » (Coup d'état, compté à partir du 2e tour de table) */
  emptySince?: number | null;
}

export type Prompt = { chooser: string; text: string; cardId?: string } & (
  | { kind: "player"; options: string[] }
  | { kind: "option"; options: string[] }
  | { kind: "number"; min: number; max: number }
  | { kind: "cards"; options: string[]; min: number; max: number; blind?: boolean }
  | { kind: "order"; options: string[] }
  /** choisir une place (index d'insertion) sur le terrain de `uid` pour la carte `card` */
  | { kind: "slot"; uid: string; card: string }
);

/** Action en cours de résolution (rejouée depuis l'état d'avant avec les réponses déjà données). */
export type EffectAction =
  | { t: "activate"; by: string }
  | { t: "play"; by: string; card: string; target: string; index: number }
  | { t: "endTurn"; by: string }
  | { t: "discard"; by: string; card: string };

export interface Pending {
  action: EffectAction;
  /** réponses déjà données, en JSON (Firestore n'accepte pas les tableaux imbriqués) */
  answers: string[];
  rolls: number[];
  prompt: Prompt;
  /** choix déjà faits pendant cette action (affichés pour suivre où on en est) */
  trail?: TrailStep[];
}
/** Un choix déjà fait : carte qui l'a demandé, question, réponse en clair. */
export type TrailStep = { card: string; chooser: string; text: string; label: string };

/** Cartes au moment d'un jet de dé : la table les affiche ainsi tant que le dé n'est pas tombé (le hasard d'abord, l'effet ensuite). */
export interface DiceSnap {
  z: Record<string, { terrain: string[]; hand: string[]; discard: string[]; deck: string[] }>;
  disabled: Record<string, Partial<Until>>;
}

export type Fx =
  | { id: number; k: "activate"; card: string; uid: string }
  | { id: number; k: "fail"; card: string; uid: string; reason?: string }
  /** mélange d'une zone (pioche, défausse, terrain, main) */
  | { id: number; k: "shuffle"; uid: string; zone: Zone }
  | { id: number; k: "gold"; uid: string; delta: number }
  | { id: number; k: "sentience"; uid: string; v: boolean }
  | { id: number; k: "bh"; uid: string; to: BlackHole }
  | { id: number; k: "weather"; uid: string; to: Weather | null }
  | { id: number; k: "dice"; uid: string; faces: number; value: number; bh?: boolean; sent?: boolean; snap?: DiceSnap; outcome?: string[] }
  /** tirage d'un joueur au hasard (roulette) */
  | { id: number; k: "roulette"; uid: string; options: string[]; value: string; label: string; snap?: DiceSnap }
  | { id: number; k: "move"; card: string }
  | { id: number; k: "banner"; text: string }
  /** annonce du joueur dont c'est le tour */
  | { id: number; k: "turn"; uid: string }
  /** tirage d'une condition de victoire (uid null = condition commune) */
  | { id: number; k: "vc"; uid: string | null; card: string }
  /** condition de victoire remplie */
  | { id: number; k: "vcDone"; uid: string; card: string; team: string }
  /** début d'une phase du tour */
  | { id: number; k: "phase"; uid: string; phase: Phase }
  /** une carte agit sur une autre carte ou sur un joueur (flèche) */
  | { id: number; k: "link"; from: string; to: string; toUid?: string; text: string };
export type FxInput = Fx extends infer T ? (T extends Fx ? Omit<T, "id"> : never) : never;

export type Phase = "activation" | "action" | "end";
export type Vote = "continue" | "stop" | "restart";

export interface LogEntry {
  ts: number;
  text: string;
  /** carte à l'origine */
  src?: string;
  /** carte qui subit */
  dst?: string;
  /** joueur à l'origine / joueur touché */
  from?: string;
  to?: string;
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
  /** `recap` : dernières actions de l'équipe avant sa victoire (résumé affiché aux joueurs) ; `vcs` : ses conditions remplies */
  ranking: { team: string; round: number; recap?: string[]; vcs?: string[] }[];
  vote: Record<string, Vote> | null;
  log: LogEntry[];
  /** horodatage du lancement (pour jouer l'animation de mise en place) */
  startedAt?: number;
  /** dernière carte posée ce tour (null = défausse / rien) */
  lastPlayed?: string | null;
  /** cartes déplacées sur un terrain par un effet (condition « Pierre qui roule ») */
  movedCards?: string[];
  /** mot proposé pour « The Word », en attente du vote des autres joueurs */
  wordClaim?: { uid: string; word: string; votes: Record<string, boolean> } | null;
  /** tour global (E.pos) où chaque carte a été posée sur un terrain */
  born?: Record<string, number>;
  /** gold stockés sur une carte (Maladie draconique) */
  cardStore?: Record<string, number>;
  /** cartes qui ont joué leur effet et attendent le prochain tour de leur joueur pour rejouer */
  spent?: string[];
  /** Rhume quantique : joueur qui l'a reçu et tour global où il l'a reçu */
  rhume?: { uid: string; at: number };
  /** Rhume quantique : joueurs ayant déjà jeté leur main à cause de lui (une seule fois par joueur). */
  rhumeDone?: string[];
  /** Le deck Météo est en jeu : la météo suit le trou noir et chacun commence avec une météo au hasard. */
  meteo?: boolean;
  /** Neige parfaite : carte gelée → joueur dont le changement de météo la dégèle. */
  frozen?: Record<string, string>;
  /** Indice de temps : le trou noir du joueur ne peut pas changer jusqu'à cette position (incluse). */
  bhLock?: Record<string, number>;
  /** Albédo : les gold gagnés par `uid` pendant son prochain tour sont réduits. */
  albedo?: { uid: string; by: string; at: number } | null;
  /** cartes désactivées : leur effet et leurs passifs ne fonctionnent plus (objet vide = jusqu'à nouvel ordre) */
  disabled?: Record<string, Partial<Until>>;
  /** origine de chaque désactivation : carte qui l'a causée (`src`) et joueur qui l'a lancée (`by`) */
  disabledBy?: Record<string, { src?: string; by?: string; at?: number }>;
  /** origine d'une modification affichée dans le détail d'une carte (clé « type:id ») : carte et joueur qui l'ont causée */
  origins?: Record<string, { src?: string; by?: string }>;
  /** cartes placées sous une autre carte (hôte → cartes dessous) : elles ne sont dans aucune zone */
  under?: Record<string, string[]>;
  /** place d'origine des cartes mises sous une carte (pour les remettre en place) */
  underFrom?: Record<string, { uid: string; index: number }>;
  /** cartes « armées » : un effet en attente (prochain tour, prochain vol…) */
  armed?: string[];
  /** lien d'une carte vers un joueur ou une autre carte (cible suivie, expéditeur…) */
  marks?: Record<string, string>;
  /** cartes face visible dans une main */
  revealed?: string[];
  /** tag 🧠 ajouté jusqu'à la fin du tour en cours (Transformers) */
  tempTags?: string[];
  /** valeurs provisoires remises à la fin du tour en cours (Disconnect) */
  temp?: { uid: string; kind: "bh" | "sent" | "wx"; prev: string }[];
  /** Garde à vue : les prochaines cartes désactivées vont sous `host` */
  custody?: { host: string; uid: string; at: number } | null;
  /** Tung Tung Tung Sahur : les gold gagnés par les autres vont à `uid` jusqu'au tour global `until` */
  /** Voile (Primordial) : joueurs dont le prochain tour joue deux fois chaque carte, et joueur dont c'est le tour */
  double?: string[];
  doubleNow?: string | null;
  /** cartes retournées face cachée (Cache Oeil) : désactivées jusqu'à leur prochain passage en phase 1 */
  facedown?: string[];
  /** cartes qui lanceront un d2 au moment de se jouer (Hot) */
  hot?: string[];
  aspire?: { uid: string; until: number } | null;
  /** Rêve d'amitié / Cauchemar d'emprisonnement : pendant son prochain tour (après le tour global `after`), `by` ne peut pas
   * nuire à `prot` (« * » = ne peut toucher aucun autre joueur) */
  shields?: { by: string; prot: string; after: number }[];
  /** BezRoulette : condition validée seulement jusqu'à la fin du tour de `turnOf` */
  tempVC?: { uid: string; turnOf: string; common: boolean } | null;
}

export interface LobbyPlayer {
  uid: string;
  name: string;
  team: string;
  deck: string | null;
  joinedAt: number;
  /** prêt à lancer (salon) */
  ready?: boolean;
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
  /** joueurs exclus par l'hôte : ne peuvent plus revenir dans ce salon */
  kicked?: string[];
}
