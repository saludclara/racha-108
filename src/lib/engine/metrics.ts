import type { DataProvider, HistoryEntry, MarketType } from "./types";

export type BucketStats = {
  key: string;
  n: number;
  hits: number;
  hitRate: number | null;
  avgEdge: number | null;
};

export type SoftBlacklist = {
  leagues: Set<string>;
  providers: Set<DataProvider>;
};

/**
 * Soft blacklist: leagues/providers with enough settled bets and weak hit-rate.
 * Requires minN so early noise does not nuke the board.
 */
export function softBlacklists(
  history: HistoryEntry[],
  opts?: { window?: number; minN?: number; maxHitRate?: number },
): SoftBlacklist {
  const window = opts?.window ?? 100;
  const minN = opts?.minN ?? 8;
  const maxHitRate = opts?.maxHitRate ?? 0.35;
  const m = computeMotorMetrics(history, window);
  const leagues = new Set<string>();
  const providers = new Set<DataProvider>();
  for (const b of m.byLeague) {
    if (b.n >= minN && b.hitRate != null && b.hitRate < maxHitRate) {
      leagues.add(b.key);
    }
  }
  for (const b of m.byProvider) {
    if (
      b.n >= minN &&
      b.hitRate != null &&
      b.hitRate < maxHitRate &&
      (b.key === "espn" ||
        b.key === "api-football" ||
        b.key === "odds-api" ||
        b.key === "pandascore")
    ) {
      providers.add(b.key);
    }
  }
  return { leagues, providers };
}

export type MotorMetrics = {
  window: number;
  settled: number;
  wins: number;
  losses: number;
  pushes: number;
  skips: number;
  hitRate: number | null;
  avgEdge: number | null;
  avgModelProb: number | null;
  /** Mean squared error of modelProb vs outcome (win=1, loss=0). */
  brier: number | null;
  byMarket: BucketStats[];
  byLeague: BucketStats[];
  byProvider: BucketStats[];
};

function mean(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function bucket(
  rows: HistoryEntry[],
  keyFn: (h: HistoryEntry) => string | undefined,
): BucketStats[] {
  const map = new Map<string, HistoryEntry[]>();
  for (const h of rows) {
    const k = keyFn(h);
    if (!k) continue;
    const list = map.get(k) ?? [];
    list.push(h);
    map.set(k, list);
  }
  return [...map.entries()]
    .map(([key, list]) => {
      const decided = list.filter((h) => h.outcome === "win" || h.outcome === "loss");
      const hits = decided.filter((h) => h.outcome === "win").length;
      const edges = decided
        .map((h) => h.edge)
        .filter((e): e is number => typeof e === "number");
      return {
        key,
        n: decided.length,
        hits,
        hitRate: decided.length ? hits / decided.length : null,
        avgEdge: mean(edges),
      };
    })
    .filter((b) => b.n > 0)
    .sort((a, b) => b.n - a.n);
}

/** Hit-rate / Brier / edge from liquidated history (excludes pending). */
export function computeMotorMetrics(
  history: HistoryEntry[],
  window = 200,
): MotorMetrics {
  const slice = history.slice(0, window);
  const settled = slice.filter(
    (h) =>
      h.outcome === "win" ||
      h.outcome === "loss" ||
      h.outcome === "push",
  );
  const decided = settled.filter(
    (h) => h.outcome === "win" || h.outcome === "loss",
  );
  const wins = decided.filter((h) => h.outcome === "win").length;
  const losses = decided.filter((h) => h.outcome === "loss").length;
  const pushes = settled.filter((h) => h.outcome === "push").length;
  const skips = slice.filter((h) => h.outcome === "skip").length;

  const edges = decided
    .map((h) => h.edge)
    .filter((e): e is number => typeof e === "number");
  const probs = decided
    .map((h) => h.modelProb)
    .filter((p): p is number => typeof p === "number");

  let brierSum = 0;
  let brierN = 0;
  for (const h of decided) {
    if (typeof h.modelProb !== "number") continue;
    const y = h.outcome === "win" ? 1 : 0;
    brierSum += (h.modelProb - y) ** 2;
    brierN += 1;
  }

  return {
    window,
    settled: settled.length,
    wins,
    losses,
    pushes,
    skips,
    hitRate: decided.length ? wins / decided.length : null,
    avgEdge: mean(edges),
    avgModelProb: mean(probs),
    brier: brierN ? brierSum / brierN : null,
    byMarket: bucket(decided, (h) => h.marketLabel),
    byLeague: bucket(decided, (h) => h.league),
    byProvider: bucket(decided, (h) => h.provider),
  };
}

export function historyToCsv(history: HistoryEntry[]): string {
  const headers = [
    "at",
    "hourKey",
    "outcome",
    "matchLabel",
    "marketLabel",
    "league",
    "provider",
    "odds",
    "bookOdds",
    "modelProb",
    "edge",
    "oddsSource",
    "score",
    "stake",
    "profit",
    "shadowWouldSkip",
  ];
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const h of history) {
    lines.push(
      [
        h.at,
        h.hourKey,
        h.outcome,
        h.matchLabel,
        h.marketLabel,
        h.league,
        h.provider,
        h.odds,
        h.bookOdds,
        h.modelProb,
        h.edge,
        h.oddsSource,
        h.score,
        h.stake,
        h.profit,
        h.shadowWouldSkip,
      ]
        .map(esc)
        .join(","),
    );
  }
  return lines.join("\n");
}

export type { MarketType };
