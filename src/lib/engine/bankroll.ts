import {
  STAKE_BASE,
  STREAK_GOAL,
  TILT_GUARD_HOURS,
  type AppSettings,
  type AppState,
  type HistoryEntry,
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
): number {
  if (!tiltGuardUntil) return settings.scoreThreshold;
  if (now.getTime() < new Date(tiltGuardUntil).getTime()) {
    return Math.min(98, settings.scoreThreshold + 6);
  }
  return settings.scoreThreshold;
}

export function isTiltActive(
  tiltGuardUntil: string | null,
  now = new Date(),
): boolean {
  if (!tiltGuardUntil) return false;
  return now.getTime() < new Date(tiltGuardUntil).getTime();
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
  };

  return {
    ...state,
    hotStack: newHot,
    vault: newVault,
    streak: newStreak,
    bestStreak: Math.max(state.bestStreak, newStreak),
    history: [entry, ...state.history],
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
  const tiltUntil = new Date(now.getTime() + TILT_GUARD_HOURS * 60 * 60 * 1000);

  const entry: HistoryEntry = {
    id: `bet-${now.getTime()}`,
    hourKey: pick.hourKey,
    at: now.toISOString(),
    outcome: "loss",
    stake,
    odds: pick.odds,
    payout: 0,
    profit: roundMoney(-stake),
    vaultAdded: 0,
    marketLabel: pick.marketLabel,
    matchLabel: `${pick.match.home.name} vs ${pick.match.away.name}`,
    score: pick.totalScore,
    layers: pick.layers,
    note: `Loss protocol: HotStack reset. Vault intacto. Tilt guard ${TILT_GUARD_HOURS}h.`,
  };

  return {
    ...state,
    hotStack: STAKE_BASE,
    streak: 0,
    tiltGuardUntil: tiltUntil.toISOString(),
    history: [entry, ...state.history],
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
    history: [entry, ...state.history],
    pickStatus: "skipped",
    lastResolvedHourKey: hourKey,
    currentPick: null,
  };
}

function seededUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // xorshift-ish to (0,1)
  let x = h >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 4294967296;
}

/**
 * Deterministic per hour+market. Win chance tracks modelProb closely
 * (high-accuracy grind) with a tiny noise floor for realism.
 */
export function simulateOutcome(pick: ScoredPick): boolean {
  const roll = seededUnit(`${pick.hourKey}|${pick.match.id}|${pick.market}`);
  const p = Math.min(0.975, Math.max(0.72, pick.modelProb * 0.995));
  return roll < p;
}
