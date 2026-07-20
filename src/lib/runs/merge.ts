import type {
  AppState,
  BetOutcome,
  HistoryEntry,
  Lesson,
  VaultDeposit,
} from "@/lib/engine";

const MAX_HISTORY = 200;
const MAX_LEDGER = 100;
const MAX_LESSONS = 40;

const OUTCOME_RANK: Record<BetOutcome, number> = {
  win: 4,
  loss: 4,
  push: 4,
  skip: 3,
  pending: 1,
};

function preferHistoryEntry(a: HistoryEntry, b: HistoryEntry): HistoryEntry {
  const rankA = OUTCOME_RANK[a.outcome] ?? 0;
  const rankB = OUTCOME_RANK[b.outcome] ?? 0;
  if (rankB !== rankA) return rankB > rankA ? b : a;
  // Prefer the richer / newer row when outcomes tie
  const filled = (h: HistoryEntry) =>
    Number(h.matchLabel != null) +
    Number(h.marketLabel != null) +
    Number(h.score != null) +
    Number(h.odds != null) +
    Number(h.layers != null);
  if (filled(b) !== filled(a)) return filled(b) > filled(a) ? b : a;
  return b.at >= a.at ? b : a;
}

/** Union histories by id; drop pending when a settled row exists for same hourKey. */
export function mergeHistory(
  a: HistoryEntry[],
  b: HistoryEntry[],
): HistoryEntry[] {
  const byId = new Map<string, HistoryEntry>();
  for (const row of [...a, ...b]) {
    if (!row?.id || !row.hourKey) continue;
    const prev = byId.get(row.id);
    byId.set(row.id, prev ? preferHistoryEntry(prev, row) : row);
  }

  const byHour = new Map<string, HistoryEntry[]>();
  for (const row of byId.values()) {
    const list = byHour.get(row.hourKey) ?? [];
    list.push(row);
    byHour.set(row.hourKey, list);
  }

  const out: HistoryEntry[] = [];
  for (const list of byHour.values()) {
    const settled = list.filter((h) => h.outcome !== "pending");
    out.push(...(settled.length ? settled : list));
  }

  out.sort((x, y) => (y.at < x.at ? -1 : y.at > x.at ? 1 : 0));
  return out.slice(0, MAX_HISTORY);
}

export function mergeVaultLedger(
  a: VaultDeposit[],
  b: VaultDeposit[],
): VaultDeposit[] {
  const byId = new Map<string, VaultDeposit>();
  for (const row of [...a, ...b]) {
    if (!row?.id) continue;
    const prev = byId.get(row.id);
    if (!prev || row.at >= prev.at) byId.set(row.id, row);
  }
  return [...byId.values()]
    .sort((x, y) => (y.at < x.at ? -1 : y.at > x.at ? 1 : 0))
    .slice(0, MAX_LEDGER);
}

export function mergeLessons(a: Lesson[] = [], b: Lesson[] = []): Lesson[] {
  const byId = new Map<string, Lesson>();
  for (const row of [...a, ...b]) {
    if (!row?.id) continue;
    const prev = byId.get(row.id);
    if (!prev || row.createdAt >= prev.createdAt) byId.set(row.id, row);
  }
  return [...byId.values()]
    .sort((x, y) => (y.createdAt < x.createdAt ? -1 : y.createdAt > x.createdAt ? 1 : 0))
    .slice(0, MAX_LESSONS);
}

/**
 * Adopt live bankroll/pick fields from `remote`, but never drop unique
 * history / ledger rows that only exist on `local`.
 */
export function adoptCloudState(local: AppState, remote: AppState): AppState {
  return {
    ...remote,
    history: mergeHistory(local.history, remote.history),
    lessons: mergeLessons(local.lessons, remote.lessons),
    vaultLedger: mergeVaultLedger(local.vaultLedger, remote.vaultLedger),
    bestStreak: Math.max(local.bestStreak, remote.bestStreak),
    createdAt:
      local.createdAt && remote.createdAt
        ? local.createdAt < remote.createdAt
          ? local.createdAt
          : remote.createdAt
        : remote.createdAt || local.createdAt,
  };
}
