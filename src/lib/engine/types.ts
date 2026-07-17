export const STAKE_BASE = 11.11;
export const STREAK_GOAL = 108;
export const DEFAULT_SCORE_THRESHOLD = 82;
export const TILT_GUARD_HOURS = 6;
export const MIN_ODDS = 1.05;
export const MAX_ODDS = 1.25;
export const DEFAULT_TIMEZONE = "Australia/Sydney";

export type MarketType =
  | "home_win"
  | "double_chance_1x"
  | "draw_no_bet_home"
  | "under_25"
  | "under_35"
  | "btts_no"
  | "ah_home_m025"
  | "ah_home_m05";

export type BetOutcome = "win" | "loss" | "skip" | "pending" | "push";

export interface TeamStats {
  name: string;
  attack: number;
  defense: number;
  form: number[];
  xgFor: number;
  xgAgainst: number;
  shotsPerGame: number;
  possession: number;
  restDays: number;
  injuries: number;
  motivation: number;
}

export type SportCategory =
  | "football"
  | "basketball"
  | "tennis"
  | "mma"
  | "hockey"
  | "esports";

export type DataProvider =
  | "espn"
  | "api-football"
  | "odds-api"
  | "pandascore";

export type OddsSource = "book" | "model";

export interface MatchCandidate {
  id: string;
  kickoff: string;
  league: string;
  home: TeamStats;
  away: TeamStats;
  odds: Partial<Record<MarketType, number>>;
  /** Per-market: bookmaker vs model-fabricated (never treat model as book). */
  oddsSource?: Partial<Record<MarketType, OddsSource>>;
  matchday: number;
  /** Real provider id (e.g. ESPN event id) */
  externalId?: string;
  kickoffUtc?: string;
  status?: "scheduled" | "inplay" | "finished";
  homeScore?: number;
  awayScore?: number;
  /** Elapsed match minutes when known (live). */
  minute?: number;
  provider?: DataProvider;
  sport?: SportCategory;
  /** Stable key for cross-provider merge */
  canonicalId?: string;
  /** Extra provider ids for the same fixture */
  providers?: Partial<Record<DataProvider, string>>;
}

export interface LayerScore {
  key: "football" | "stats" | "value" | "numerology" | "stars";
  label: string;
  weight: number;
  score: number;
  note: string;
}

export interface ScoredPick {
  match: MatchCandidate;
  market: MarketType;
  marketLabel: string;
  odds: number;
  modelProb: number;
  edge: number;
  /** Book decimal odds when oddsSource=book; else undefined. */
  bookOdds?: number;
  oddsSource: OddsSource;
  totalScore: number;
  layers: LayerScore[];
  hourKey: string;
  /** Shadow EV decision (logged; may differ when guarantee forces a pick). */
  shadowWouldSkip?: boolean;
  shadowNote?: string;
}

export interface VaultDeposit {
  id: string;
  at: string;
  amount: number;
  streakAtDeposit: number;
  note: string;
}

export interface HistoryEntry {
  id: string;
  hourKey: string;
  at: string;
  outcome: BetOutcome;
  stake: number;
  odds?: number;
  payout?: number;
  profit?: number;
  vaultAdded?: number;
  marketLabel?: string;
  matchLabel?: string;
  score?: number;
  layers?: LayerScore[];
  note?: string;
  /** Motor telemetry */
  modelProb?: number;
  edge?: number;
  bookOdds?: number;
  oddsSource?: OddsSource;
  provider?: DataProvider;
  league?: string;
  matchId?: string;
  shadowWouldSkip?: boolean;
}

export interface AppSettings {
  timezone: string;
  scoreThreshold: number;
  vaultSplitEarly: number;
  vaultSplitMid: number;
  vaultSplitLate: number;
  /** Free optional sources (need env keys on server) */
  enableApiFootball: boolean;
  enableOddsApi: boolean;
  enableEsports: boolean;
}

export interface AppState {
  hotStack: number;
  vault: number;
  streak: number;
  bestStreak: number;
  tiltGuardUntil: string | null;
  settings: AppSettings;
  history: HistoryEntry[];
  vaultLedger: VaultDeposit[];
  currentPick: ScoredPick | null;
  currentHourKey: string | null;
  pickStatus: "idle" | "ready" | "placed" | "skipped" | "resolved" | "pending";
  lastResolvedHourKey: string | null;
  goalReached: boolean;
  createdAt: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  timezone: DEFAULT_TIMEZONE,
  scoreThreshold: DEFAULT_SCORE_THRESHOLD,
  vaultSplitEarly: 0.2,
  vaultSplitMid: 0.5,
  vaultSplitLate: 0.7,
  enableApiFootball: true,
  enableOddsApi: true,
  enableEsports: true,
};

export function createInitialState(): AppState {
  return {
    hotStack: STAKE_BASE,
    vault: 0,
    streak: 0,
    bestStreak: 0,
    tiltGuardUntil: null,
    settings: { ...DEFAULT_SETTINGS },
    history: [],
    vaultLedger: [],
    currentPick: null,
    currentHourKey: null,
    pickStatus: "idle",
    lastResolvedHourKey: null,
    goalReached: false,
    createdAt: new Date().toISOString(),
  };
}
