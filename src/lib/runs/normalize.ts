import {
  createInitialState,
  DEFAULT_SETTINGS,
  type AppSettings,
  type AppState,
  type BetOutcome,
  type HistoryEntry,
  type LayerScore,
  type MarketType,
  type ScoredPick,
  type VaultDeposit,
} from "@/lib/engine";

const MAX_HISTORY = 200;
const MAX_LEDGER = 100;
const MAX_LAYERS = 12;

const MARKETS = new Set<MarketType>([
  "home_win",
  "double_chance_1x",
  "draw_no_bet_home",
  "under_25",
  "under_35",
  "btts_no",
  "ah_home_m025",
  "ah_home_m05",
]);

const OUTCOMES = new Set<BetOutcome>([
  "win",
  "loss",
  "skip",
  "pending",
  "push",
]);

const PICK_STATUSES = new Set<AppState["pickStatus"]>([
  "idle",
  "ready",
  "placed",
  "skipped",
  "resolved",
  "pending",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function finiteNumber(v: unknown, fallback: number, min = 0, max = 1e9): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function optString(v: unknown, max = 500): string | null {
  if (typeof v !== "string") return null;
  return v.slice(0, max);
}

function normalizeSettings(raw: unknown): AppSettings {
  const base = { ...DEFAULT_SETTINGS };
  if (!isPlainObject(raw)) return base;
  return {
    timezone: optString(raw.timezone, 80) || base.timezone,
    scoreThreshold: finiteNumber(raw.scoreThreshold, base.scoreThreshold, 50, 99),
    vaultSplitEarly: finiteNumber(raw.vaultSplitEarly, base.vaultSplitEarly, 0, 1),
    vaultSplitMid: finiteNumber(raw.vaultSplitMid, base.vaultSplitMid, 0, 1),
    vaultSplitLate: finiteNumber(raw.vaultSplitLate, base.vaultSplitLate, 0, 1),
    enableApiFootball: raw.enableApiFootball !== false,
    enableOddsApi: raw.enableOddsApi !== false,
    enableEsports: raw.enableEsports !== false,
  };
}

function normalizeLayers(raw: unknown): LayerScore[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: LayerScore[] = [];
  for (const row of raw.slice(0, MAX_LAYERS)) {
    if (!isPlainObject(row)) continue;
    const key = row.key;
    if (
      key !== "football" &&
      key !== "stats" &&
      key !== "value" &&
      key !== "numerology" &&
      key !== "stars"
    ) {
      continue;
    }
    out.push({
      key,
      label: optString(row.label, 80) || key,
      weight: finiteNumber(row.weight, 0, 0, 10),
      score: finiteNumber(row.score, 0, 0, 100),
      note: optString(row.note, 240) || "",
    });
  }
  return out;
}

function normalizePick(raw: unknown): ScoredPick | null {
  if (!isPlainObject(raw)) return null;
  if (!isPlainObject(raw.match)) return null;
  const market = raw.market;
  if (typeof market !== "string" || !MARKETS.has(market as MarketType)) {
    return null;
  }
  const match = raw.match;
  const home = isPlainObject(match.home) ? match.home : null;
  const away = isPlainObject(match.away) ? match.away : null;
  if (!home || !away) return null;
  const homeName = optString(home.name, 120);
  const awayName = optString(away.name, 120);
  if (!homeName || !awayName) return null;

  const id = optString(match.id, 160);
  if (!id) return null;

  return {
    match: {
      id,
      kickoff: optString(match.kickoff, 64) || new Date().toISOString(),
      league: optString(match.league, 120) || "Unknown",
      home: {
        name: homeName,
        attack: finiteNumber(home.attack, 50, 0, 100),
        defense: finiteNumber(home.defense, 50, 0, 100),
        form: Array.isArray(home.form)
          ? home.form.filter((n): n is number => typeof n === "number").slice(0, 10)
          : [],
        xgFor: finiteNumber(home.xgFor, 1, 0, 20),
        xgAgainst: finiteNumber(home.xgAgainst, 1, 0, 20),
        shotsPerGame: finiteNumber(home.shotsPerGame, 10, 0, 50),
        possession: finiteNumber(home.possession, 50, 0, 100),
        restDays: finiteNumber(home.restDays, 3, 0, 30),
        injuries: finiteNumber(home.injuries, 0, 0, 30),
        motivation: finiteNumber(home.motivation, 50, 0, 100),
      },
      away: {
        name: awayName,
        attack: finiteNumber(away.attack, 50, 0, 100),
        defense: finiteNumber(away.defense, 50, 0, 100),
        form: Array.isArray(away.form)
          ? away.form.filter((n): n is number => typeof n === "number").slice(0, 10)
          : [],
        xgFor: finiteNumber(away.xgFor, 1, 0, 20),
        xgAgainst: finiteNumber(away.xgAgainst, 1, 0, 20),
        shotsPerGame: finiteNumber(away.shotsPerGame, 10, 0, 50),
        possession: finiteNumber(away.possession, 50, 0, 100),
        restDays: finiteNumber(away.restDays, 3, 0, 30),
        injuries: finiteNumber(away.injuries, 0, 0, 30),
        motivation: finiteNumber(away.motivation, 50, 0, 100),
      },
      odds: isPlainObject(match.odds)
        ? (match.odds as ScoredPick["match"]["odds"])
        : {},
      matchday: finiteNumber(match.matchday, 1, 1, 50),
      externalId: optString(match.externalId, 80) ?? undefined,
      kickoffUtc: optString(match.kickoffUtc, 64) ?? undefined,
      status:
        match.status === "scheduled" ||
        match.status === "inplay" ||
        match.status === "finished"
          ? match.status
          : "scheduled",
      homeScore:
        typeof match.homeScore === "number" ? match.homeScore : undefined,
      awayScore:
        typeof match.awayScore === "number" ? match.awayScore : undefined,
      provider:
        match.provider === "espn" ||
        match.provider === "api-football" ||
        match.provider === "odds-api" ||
        match.provider === "pandascore"
          ? match.provider
          : undefined,
      sport:
        match.sport === "football" ||
        match.sport === "basketball" ||
        match.sport === "tennis" ||
        match.sport === "mma" ||
        match.sport === "hockey" ||
        match.sport === "esports"
          ? match.sport
          : undefined,
    },
    market: market as MarketType,
    marketLabel: optString(raw.marketLabel, 80) || market,
    odds: finiteNumber(raw.odds, 1.1, 1.01, 5),
    modelProb: finiteNumber(raw.modelProb, 0.5, 0, 1),
    edge: finiteNumber(raw.edge, 0, -1, 1),
    totalScore: finiteNumber(raw.totalScore, 0, 0, 100),
    layers: normalizeLayers(raw.layers) ?? [],
    hourKey: optString(raw.hourKey, 80) || "",
  };
}

function normalizeHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryEntry[] = [];
  for (const row of raw.slice(0, MAX_HISTORY)) {
    if (!isPlainObject(row)) continue;
    const outcome = row.outcome;
    if (typeof outcome !== "string" || !OUTCOMES.has(outcome as BetOutcome)) {
      continue;
    }
    const id = optString(row.id, 80);
    const hourKey = optString(row.hourKey, 80);
    const at = optString(row.at, 64);
    if (!id || !hourKey || !at) continue;
    out.push({
      id,
      hourKey,
      at,
      outcome: outcome as BetOutcome,
      stake: finiteNumber(row.stake, 0, 0, 1e9),
      odds: typeof row.odds === "number" ? row.odds : undefined,
      payout: typeof row.payout === "number" ? row.payout : undefined,
      profit: typeof row.profit === "number" ? row.profit : undefined,
      vaultAdded: typeof row.vaultAdded === "number" ? row.vaultAdded : undefined,
      marketLabel: optString(row.marketLabel, 80) ?? undefined,
      matchLabel: optString(row.matchLabel, 200) ?? undefined,
      score: typeof row.score === "number" ? row.score : undefined,
      layers: normalizeLayers(row.layers),
      note: optString(row.note, 240) ?? undefined,
    });
  }
  return out;
}

function normalizeLedger(raw: unknown): VaultDeposit[] {
  if (!Array.isArray(raw)) return [];
  const out: VaultDeposit[] = [];
  for (const row of raw.slice(0, MAX_LEDGER)) {
    if (!isPlainObject(row)) continue;
    const id = optString(row.id, 80);
    const at = optString(row.at, 64);
    const note = optString(row.note, 200);
    if (!id || !at || !note) continue;
    out.push({
      id,
      at,
      amount: finiteNumber(row.amount, 0, 0, 1e9),
      streakAtDeposit: finiteNumber(row.streakAtDeposit, 0, 0, 10_000),
      note,
    });
  }
  return out;
}

/** Strict allowlisted merge so client/cron payloads cannot inflate or poison state. */
export function normalizeAppState(raw: unknown): AppState | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.hotStack !== "number" || typeof raw.vault !== "number") {
    return null;
  }
  if (!isPlainObject(raw.settings)) return null;

  const base = createInitialState();
  const pickStatus = raw.pickStatus;
  const status =
    typeof pickStatus === "string" &&
    PICK_STATUSES.has(pickStatus as AppState["pickStatus"])
      ? (pickStatus as AppState["pickStatus"])
      : base.pickStatus;

  return {
    hotStack: finiteNumber(raw.hotStack, base.hotStack, 0, 1e9),
    vault: finiteNumber(raw.vault, base.vault, 0, 1e9),
    streak: finiteNumber(raw.streak, 0, 0, 10_000),
    bestStreak: finiteNumber(raw.bestStreak, 0, 0, 10_000),
    tiltGuardUntil: optString(raw.tiltGuardUntil, 64),
    settings: normalizeSettings(raw.settings),
    history: normalizeHistory(raw.history),
    vaultLedger: normalizeLedger(raw.vaultLedger),
    currentPick: normalizePick(raw.currentPick),
    currentHourKey: optString(raw.currentHourKey, 80),
    pickStatus: status,
    lastResolvedHourKey: optString(raw.lastResolvedHourKey, 80),
    goalReached: raw.goalReached === true,
    createdAt: optString(raw.createdAt, 64) || base.createdAt,
  };
}
