import { ALLOWED_MARKETS, MARKET_LABELS } from "./markets";
import type { DataProvider, HistoryEntry, MarketType } from "./types";

export { consecutiveLossCount } from "./loss-streak";

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
  /** Hard exclude — e.g. 2 losses in this market in the recent window. */
  markets: Set<MarketType>;
  /** Soft demote in rank (weak hit-rate, not yet banned). */
  coolMarkets: Set<MarketType>;
};

const LABEL_TO_MARKET = new Map(
  Object.entries(MARKET_LABELS).map(([k, v]) => [v, k as MarketType]),
);

/** Resolve market key from history (new `market` field or legacy label). */
export function marketFromEntry(h: HistoryEntry): MarketType | undefined {
  if (h.market && (ALLOWED_MARKETS as string[]).includes(h.market)) {
    return h.market;
  }
  if (h.marketLabel) {
    return LABEL_TO_MARKET.get(h.marketLabel);
  }
  return undefined;
}

/**
 * Soft blacklist: leagues/providers/markets with weak hit-rate,
 * plus early market ban after 2 recent losses in the same market.
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
  const markets = new Set<MarketType>();
  const coolMarkets = new Set<MarketType>();

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

  // Structural weak markets (enough sample)
  for (const b of m.byMarket) {
    const mk = (ALLOWED_MARKETS as string[]).includes(b.key)
      ? (b.key as MarketType)
      : LABEL_TO_MARKET.get(b.key);
    if (!mk) continue;
    if (b.n >= 4 && b.hitRate != null && b.hitRate < 0.4) {
      coolMarkets.add(mk);
    }
    if (b.n >= minN && b.hitRate != null && b.hitRate < maxHitRate) {
      markets.add(mk);
    }
  }

  // Early signal from the two losses: ≥2 L in same market among last 12 decided
  const decided = history
    .filter((h) => h.outcome === "win" || h.outcome === "loss")
    .slice(0, 12);
  const lossCount = new Map<MarketType, number>();
  for (const h of decided) {
    if (h.outcome !== "loss") continue;
    const mk = marketFromEntry(h);
    if (!mk) continue;
    lossCount.set(mk, (lossCount.get(mk) ?? 0) + 1);
  }
  for (const [mk, n] of lossCount) {
    if (n >= 2) markets.add(mk);
    else if (n >= 1) coolMarkets.add(mk);
  }

  // If last two decided are both losses (any market) → cool those markets
  const lastTwo = decided.slice(0, 2);
  if (
    lastTwo.length === 2 &&
    lastTwo.every((h) => h.outcome === "loss")
  ) {
    for (const h of lastTwo) {
      const mk = marketFromEntry(h);
      if (mk) coolMarkets.add(mk);
    }
  }

  return { leagues, providers, markets, coolMarkets };
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
    byMarket: bucket(
      decided,
      (h) => marketFromEntry(h) ?? h.marketLabel,
    ),
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
    "homeScore",
    "awayScore",
    "lessonCause",
    "plainWhy",
    "plainFix",
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
        h.homeScore,
        h.awayScore,
        h.lessonCause,
        h.plainWhy,
        h.plainFix,
      ]
        .map(esc)
        .join(","),
    );
  }
  return lines.join("\n");
}
