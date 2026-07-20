import {
  buildLossLesson,
  lessonEffects,
  pruneLessons,
} from "./autopsy";
import { consecutiveLossCount } from "./metrics";
import {
  STAKE_BASE,
  STREAK_GOAL,
  TILT_GUARD_HOURS,
  type AppSettings,
  type AppState,
  type HistoryEntry,
  type Lesson,
  type ScoredPick,
  type VaultDeposit,
} from "./types";

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function vaultSplitRatio(streak: number, settings: AppSettings): number {
  // streak is current streak BEFORE this win is counted for split bands
  // After win, newStreak = streak + 1; we use new streak for banding
  const next = streak + 1;
  if (next <= 36) return settings.vaultSplitEarly;
  if (next <= 72) return settings.vaultSplitMid;
  return settings.vaultSplitLate;
}

export function effectiveThreshold(
  settings: AppSettings,
  tiltGuardUntil: string | null,
  now = new Date(),
  history: HistoryEntry[] = [],
  lessons: Lesson[] = [],
): number {
  let bump = 0;
  if (
    tiltGuardUntil &&
    now.getTime() < new Date(tiltGuardUntil).getTime()
  ) {
    bump += 6;
  }
  // 2+ losses in a row → demand a clearer grind score
  if (consecutiveLossCount(history) >= 2) bump += 4;
  bump += lessonEffects(lessons, now).thresholdBump;
  if (!bump) return settings.scoreThreshold;
  return Math.min(98, settings.scoreThreshold + bump);
}

export function isTiltActive(
  tiltGuardUntil: string | null,
  now = new Date(),
): boolean {
  if (!tiltGuardUntil) return false;
  return now.getTime() < new Date(tiltGuardUntil).getTime();
}

/** Drop pending row for this cycle so settle/skip replaces it (no duplicates). */
function prependHistory(
  history: HistoryEntry[],
  entry: HistoryEntry,
): HistoryEntry[] {
  const rest = history.filter(
    (h) => !(h.hourKey === entry.hourKey && h.outcome === "pending"),
  );
  return [entry, ...rest];
}

function pickTelemetry(pick: ScoredPick): Partial<HistoryEntry> {
  return {
    market: pick.market,
    modelProb: pick.modelProb,
    edge: pick.edge,
    bookOdds: pick.bookOdds,
    oddsSource: pick.oddsSource,
    provider: pick.match.provider,
    league: pick.match.league,
    matchId: pick.match.id,
    shadowWouldSkip: pick.shadowWouldSkip,
  };
}

/** Record the live pick in historial as soon as it is chosen. */
export function applyPending(
  state: AppState,
  pick: ScoredPick,
  now = new Date(),
  note?: string,
): AppState {
  const entry: HistoryEntry = {
    id: `pending-${pick.hourKey}`,
    hourKey: pick.hourKey,
    at: now.toISOString(),
    outcome: "pending",
    stake: state.hotStack,
    odds: pick.odds,
    marketLabel: pick.marketLabel,
    matchLabel: `${pick.match.home.name} vs ${pick.match.away.name}`,
    score: pick.totalScore,
    layers: pick.layers,
    note: note ?? "En juego · HotStack a riesgo",
    ...pickTelemetry(pick),
  };

  return {
    ...state,
    currentHourKey: pick.hourKey,
    currentPick: pick,
    pickStatus: "pending",
    history: prependHistory(state.history, entry),
  };
}

export function applyWin(
  state: AppState,
  pick: ScoredPick,
  now = new Date(),
): AppState {
  const stake = state.hotStack;
  const payout = roundMoney(stake * pick.odds);
  const profit = roundMoney(payout - stake);
  const ratio = vaultSplitRatio(state.streak, state.settings);
  const toVault = roundMoney(profit * ratio);
  const remainProfit = roundMoney(profit - toVault);
  const newHot = roundMoney(stake + remainProfit);
  const newVault = roundMoney(state.vault + toVault);
  const newStreak = state.streak + 1;

  const deposit: VaultDeposit | null =
    toVault > 0
      ? {
          id: `vault-${now.getTime()}`,
          at: now.toISOString(),
          amount: toVault,
          streakAtDeposit: newStreak,
          note: `Split ${(ratio * 100).toFixed(0)}% del profit`,
        }
      : null;

  const entry: HistoryEntry = {
    id: `bet-${now.getTime()}`,
    hourKey: pick.hourKey,
    at: now.toISOString(),
    outcome: "win",
    stake,
    odds: pick.odds,
    payout,
    profit,
    vaultAdded: toVault,
    marketLabel: pick.marketLabel,
    matchLabel: `${pick.match.home.name} vs ${pick.match.away.name}`,
    score: pick.totalScore,
    layers: pick.layers,
    ...pickTelemetry(pick),
  };

  return {
    ...state,
    hotStack: newHot,
    vault: newVault,
    streak: newStreak,
    bestStreak: Math.max(state.bestStreak, newStreak),
    history: prependHistory(state.history, entry),
    vaultLedger: deposit
      ? [deposit, ...state.vaultLedger]
      : state.vaultLedger,
    pickStatus: "resolved",
    lastResolvedHourKey: pick.hourKey,
    currentPick: pick,
    goalReached: newStreak >= STREAK_GOAL || state.goalReached,
  };
}

export function applyLoss(
  state: AppState,
  pick: ScoredPick,
  now = new Date(),
): AppState {
  const stake = state.hotStack;
  // Trailing losses before this one + this L
  const lossStreak = consecutiveLossCount(state.history) + 1;
  const tiltHours =
    lossStreak >= 2 ? TILT_GUARD_HOURS * 2 : TILT_GUARD_HOURS;
  const tiltUntil = new Date(now.getTime() + tiltHours * 60 * 60 * 1000);
  const lossId = `bet-${now.getTime()}`;
  const lesson = buildLossLesson(pick, state.history, lossId, now);

  const entry: HistoryEntry = {
    id: lossId,
    hourKey: pick.hourKey,
    at: now.toISOString(),
    outcome: "loss",
    stake,
    odds: pick.odds,
    payout: 0,
    profit: roundMoney(-stake),
    vaultAdded: 0,
    market: pick.market,
    marketLabel: pick.marketLabel,
    matchLabel: `${pick.match.home.name} vs ${pick.match.away.name}`,
    score: pick.totalScore,
    layers: pick.layers,
    homeScore: pick.match.homeScore,
    awayScore: pick.match.awayScore,
    plainWhy: lesson.plainWhy,
    plainFix: lesson.plainFix,
    lessonId: lesson.id,
    lessonCause: lesson.cause,
    note:
      lossStreak >= 2
        ? `Autopsia ×${lossStreak}: ${lesson.cause} · Tilt ${tiltHours}h · HotStack reset.`
        : `Autopsia 1L: ${lesson.cause} · Tilt ${tiltHours}h · HotStack reset.`,
    ...pickTelemetry(pick),
  };

  return {
    ...state,
    hotStack: STAKE_BASE,
    streak: 0,
    tiltGuardUntil: tiltUntil.toISOString(),
    history: prependHistory(state.history, entry),
    lessons: pruneLessons([lesson, ...(state.lessons ?? [])], now),
    pickStatus: "resolved",
    lastResolvedHourKey: pick.hourKey,
    currentPick: pick,
  };
}

export function applySkip(
  state: AppState,
  hourKey: string,
  reason: string,
  now = new Date(),
): AppState {
  const entry: HistoryEntry = {
    id: `skip-${now.getTime()}`,
    hourKey,
    at: now.toISOString(),
    outcome: "skip",
    stake: 0,
    note: reason,
  };

  return {
    ...state,
    history: prependHistory(state.history, entry),
    pickStatus: "skipped",
    lastResolvedHourKey: hourKey,
    currentPick: null,
  };
}

/** Draw No Bet / abandon void: stake back, streak unchanged */
export function applyPush(
  state: AppState,
  pick: ScoredPick,
  now = new Date(),
  note = "Push (ej. DNB en empate) — stake devuelto",
): AppState {
  const stake = state.hotStack;
  const entry: HistoryEntry = {
    id: `bet-${now.getTime()}`,
    hourKey: pick.hourKey,
    at: now.toISOString(),
    outcome: "push",
    stake,
    odds: pick.odds,
    payout: stake,
    profit: 0,
    vaultAdded: 0,
    marketLabel: pick.marketLabel,
    matchLabel: `${pick.match.home.name} vs ${pick.match.away.name}`,
    score: pick.totalScore,
    layers: pick.layers,
    note,
    ...pickTelemetry(pick),
  };

  return {
    ...state,
    history: prependHistory(state.history, entry),
    pickStatus: "resolved",
    lastResolvedHourKey: pick.hourKey,
    currentPick: pick,
  };
}
