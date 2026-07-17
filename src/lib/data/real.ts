import { fetchAllMatches } from "@/lib/data/providers/registry";
import type { SourceStatus } from "@/lib/data/providers/types";
import { CYCLE_MS } from "@/lib/engine/schedule";
import { pickBestForHour } from "@/lib/engine/score";
import { settlePick } from "@/lib/engine/settle";
import type { MatchCandidate, ScoredPick } from "@/lib/engine/types";

/** Tolerate FT landing within this cycle + one more (keeps HotStack turning). */
export const SETTLE_SLACK_MS = CYCLE_MS;

const FOOTBALL_MATCH_MS = 110 * 60_000;
const ESPORTS_MATCH_MS = 50 * 60_000;
const ESPORTS_KICKOFF_SOON_MS = 30 * 60_000;
/** Max look-ahead for a new pick — never lock HotStack on day/wide fixtures. */
const NEAR_KICKOFF_MS = 6 * 3600_000;

export type HourlyPickResponse = {
  ok: true;
  hourKey: string;
  status: "pending" | "settled" | "empty";
  pick: ScoredPick | null;
  settle: "win" | "loss" | "push" | null;
  matchCount: number;
  message?: string;
  fetchedAt: string;
  sources?: SourceStatus[];
};

export type FeedOptions = {
  enableApiFootball?: boolean;
  enableOddsApi?: boolean;
  enableEsports?: boolean;
};

function estimatedMatchMs(m: MatchCandidate): number {
  return m.sport === "esports" ? ESPORTS_MATCH_MS : FOOTBALL_MATCH_MS;
}

function kickoffMs(m: MatchCandidate): number {
  return new Date(m.kickoffUtc ?? m.kickoff).getTime();
}

/** Expected FT + settle slack — past this, unlock HotStack (void/push). */
export function abandonDeadlineMs(match: MatchCandidate): number {
  const kick = kickoffMs(match);
  if (!Number.isFinite(kick)) return Number.POSITIVE_INFINITY;
  return kick + estimatedMatchMs(match) + SETTLE_SLACK_MS;
}

export function shouldAbandonPick(pick: ScoredPick, now: Date): boolean {
  if (now.getTime() > abandonDeadlineMs(pick.match)) return true;

  // Unlock legacy day/wide locks: still scheduled and kickoff beyond near window
  const status = pick.match.status ?? "scheduled";
  const kick = kickoffMs(pick.match);
  if (
    status === "scheduled" &&
    Number.isFinite(kick) &&
    kick - now.getTime() > NEAR_KICKOFF_MS
  ) {
    return true;
  }
  return false;
}

/**
 * Some feeds leave `inplay` with final scores after FT.
 * If kickoff+duration passed and both scores exist → treat as finished.
 */
function withInferredFinish(
  match: MatchCandidate,
  now: Date,
): MatchCandidate {
  if (match.status === "finished") return match;
  if (match.homeScore == null || match.awayScore == null) return match;
  const kick = kickoffMs(match);
  if (!Number.isFinite(kick)) return match;
  if (now.getTime() < kick + estimatedMatchMs(match)) return match;
  return { ...match, status: "finished" };
}

/** Drop zombie fixtures that should have finished already (stale feed). */
function isFreshEnough(m: MatchCandidate, now: Date): boolean {
  if (m.status === "finished") return false;
  const kick = kickoffMs(m);
  if (!Number.isFinite(kick)) return false;
  return now.getTime() <= kick + estimatedMatchMs(m) + SETTLE_SLACK_MS;
}

/**
 * Only matches that can realistically close soon so HotStack frees each cycle.
 * Priority: inplay → kickoff already passed → esports starting very soon.
 */
export function settleableForCycle(
  candidates: MatchCandidate[],
  now: Date,
): MatchCandidate[] {
  const t = now.getTime();
  const deadline = t + SETTLE_SLACK_MS;

  const inplay: MatchCandidate[] = [];
  const kickedOff: MatchCandidate[] = [];
  const esportsSoon: MatchCandidate[] = [];

  for (const m of candidates) {
    if (m.status === "finished") continue;

    const kick = kickoffMs(m);
    if (!Number.isFinite(kick)) continue;

    // 1) Live — high chance of FT this/next cycle
    if (m.status === "inplay") {
      inplay.push(m);
      continue;
    }

    // 2) Kickoff already passed (delay / about to flip live)
    if (kick <= t) {
      // Still exclude if it's been "scheduled" for absurdly long (stale feed)
      if (t - kick <= FOOTBALL_MATCH_MS + CYCLE_MS) {
        kickedOff.push(m);
      }
      continue;
    }

    // 3) Esports Bo1-ish starting within ~30m and expected FT inside slack
    if (m.sport === "esports" && kick - t <= ESPORTS_KICKOFF_SOON_MS) {
      const expectedFt = kick + estimatedMatchMs(m);
      if (expectedFt <= deadline) {
        esportsSoon.push(m);
      }
      continue;
    }

    // Football (and other) scheduled with expected FT beyond slack → exclude
  }

  if (inplay.length) return inplay;
  if (kickedOff.length) return kickedOff;
  if (esportsSoon.length) return esportsSoon;
  return [];
}

/**
 * Prefer settleable (live), then kickoff ≤6h.
 * Never day/wide — those locked HotStack for days on one pick.
 */
export function candidatePoolForCycle(
  candidates: MatchCandidate[],
  now: Date,
): { pool: MatchCandidate[]; tier: "settleable" | "near" | "empty" } {
  const open = candidates.filter((m) => isFreshEnough(m, now));
  const settleable = settleableForCycle(open, now);
  if (settleable.length) return { pool: settleable, tier: "settleable" };

  const t = now.getTime();
  const near = open.filter((m) => {
    if (m.status === "inplay") return true;
    const kick = kickoffMs(m);
    return (
      Number.isFinite(kick) &&
      kick >= t - 2 * 3600_000 &&
      kick <= t + NEAR_KICKOFF_MS
    );
  });
  if (near.length) return { pool: near, tier: "near" };

  return { pool: [], tier: "empty" };
}

function findMatch(
  all: MatchCandidate[],
  pick: ScoredPick,
): MatchCandidate | undefined {
  return all.find((m) => {
    if (m.id === pick.match.id) return true;
    if (
      pick.match.externalId &&
      (m.externalId === pick.match.externalId ||
        Object.values(m.providers ?? {}).includes(pick.match.externalId))
    ) {
      return true;
    }
    if (pick.match.canonicalId && m.canonicalId === pick.match.canonicalId) {
      return true;
    }
    return false;
  });
}

function settledResponse(
  hourKey: string,
  pick: ScoredPick,
  settle: "win" | "loss" | "push",
  matchCount: number,
  sources: SourceStatus[],
  message: string,
  now: Date,
): HourlyPickResponse {
  return {
    ok: true,
    hourKey,
    status: "settled",
    pick,
    settle,
    matchCount,
    sources,
    message,
    fetchedAt: now.toISOString(),
  };
}

function trySettleFinished(
  pick: ScoredPick,
  fresh: MatchCandidate,
  matchCount: number,
  sources: SourceStatus[],
  now: Date,
): HourlyPickResponse {
  const refreshed: ScoredPick = {
    ...pick,
    match: fresh,
    hourKey: pick.hourKey,
  };
  const settle = settlePick(refreshed);
  if (settle) {
    return settledResponse(
      pick.hourKey,
      refreshed,
      settle,
      matchCount,
      sources,
      `Resultado real ${fresh.homeScore}-${fresh.awayScore} · HotStack listo`,
      now,
    );
  }
  // FT without readable scores → void (push) so HotStack unlocks
  return settledResponse(
    pick.hourKey,
    refreshed,
    "push",
    matchCount,
    sources,
    "FT sin marcador legible · push (stake devuelto)",
    now,
  );
}

export type MatchFeedSnapshot = {
  matches: MatchCandidate[];
  sources: SourceStatus[];
};

/** Pure pick builder over an already-fetched feed (cron reuses one snapshot). */
export function buildHourlyPickFromMatches(
  hourKey: string,
  threshold: number,
  all: MatchCandidate[],
  sources: SourceStatus[],
  now = new Date(),
): HourlyPickResponse {
  const { pool, tier } = candidatePoolForCycle(all, now);

  if (!pool.length) {
    return {
      ok: true,
      hourKey,
      status: "empty",
      pick: null,
      settle: null,
      matchCount: all.length,
      sources,
      message:
        all.length === 0
          ? "No se pudieron obtener partidos ahora. Reintentá en un minuto."
          : "Sin partidos liquidables (live / kickoff ≤6h). HotStack libre.",
      fetchedAt: now.toISOString(),
    };
  }

  const pick = pickBestForHour(pool, hourKey, threshold, now, {
    guarantee: true,
  });

  if (!pick) {
    return {
      ok: true,
      hourKey,
      status: "empty",
      pick: null,
      settle: null,
      matchCount: pool.length,
      sources,
      message:
        "Hay partidos, pero ninguno tiene mercado grind con cuotas válidas.",
      fetchedAt: now.toISOString(),
    };
  }

  const fresh = withInferredFinish(findMatch(all, pick) ?? pick.match, now);
  const refreshed: ScoredPick = { ...pick, match: fresh, hourKey };

  if (fresh.status === "finished") {
    return trySettleFinished(
      refreshed,
      fresh,
      pool.length,
      sources,
      now,
    );
  }

  const tierNote =
    tier === "settleable" ? "ventana liquidable" : "kickoff ≤6h";

  return {
    ok: true,
    hourKey,
    status: "pending",
    pick: refreshed,
    settle: null,
    matchCount: pool.length,
    sources,
    message: `Pick del ciclo · ${tierNote} · ${fresh.status === "inplay" ? "en juego" : "kickoff"} ${new Date(fresh.kickoffUtc ?? fresh.kickoff).toLocaleString("es-AU")}`,
    fetchedAt: now.toISOString(),
  };
}

export async function buildHourlyPick(
  hourKey: string,
  threshold: number,
  now = new Date(),
  feed: FeedOptions = {},
): Promise<HourlyPickResponse> {
  const { matches: all, sources } = await fetchAllMatches({
    now,
    ...feed,
  });
  return buildHourlyPickFromMatches(hourKey, threshold, all, sources, now);
}

/** Pure settlement refresh over an already-fetched feed. */
export function refreshPickSettlementFromMatches(
  pick: ScoredPick,
  all: MatchCandidate[],
  sources: SourceStatus[],
  now = new Date(),
): HourlyPickResponse {
  const found = findMatch(all, pick) ?? null;
  const fresh = found ? withInferredFinish(found, now) : null;

  if (!fresh) {
    if (shouldAbandonPick(pick, now)) {
      return settledResponse(
        pick.hourKey,
        pick,
        "push",
        all.length,
        sources,
        "Partido desapareció del feed tras FT · push (stake devuelto)",
        now,
      );
    }
    return {
      ok: true,
      hourKey: pick.hourKey,
      status: "pending",
      pick,
      settle: null,
      matchCount: all.length,
      sources,
      message:
        "Esperando resultado · HotStack a riesgo · partido aún no en el feed.",
      fetchedAt: now.toISOString(),
    };
  }

  const refreshed: ScoredPick = {
    ...pick,
    match: fresh,
    hourKey: pick.hourKey,
  };

  if (fresh.status === "finished") {
    return trySettleFinished(refreshed, fresh, all.length, sources, now);
  }

  // Stale: expected FT + slack passed, or legacy far-future lock
  if (shouldAbandonPick(refreshed, now)) {
    const far =
      (fresh.status ?? "scheduled") === "scheduled" &&
      kickoffMs(fresh) - now.getTime() > NEAR_KICKOFF_MS;
    return settledResponse(
      pick.hourKey,
      refreshed,
      "push",
      all.length,
      sources,
      far
        ? "Pick fuera de ventana liquidable · push (stake devuelto)"
        : `Sin FT a tiempo (${fresh.status}) · push (stake devuelto)`,
      now,
    );
  }

  return {
    ok: true,
    hourKey: pick.hourKey,
    status: "pending",
    pick: refreshed,
    settle: null,
    matchCount: all.length,
    sources,
    message: `Esperando resultado · HotStack a riesgo · ${fresh.status}`,
    fetchedAt: now.toISOString(),
  };
}

/** Resolve a previously chosen pick against live multi-source data */
export async function refreshPickSettlement(
  pick: ScoredPick,
  now = new Date(),
  feed: FeedOptions = {},
): Promise<HourlyPickResponse> {
  const { matches: all, sources } = await fetchAllMatches({
    now,
    ...feed,
  });
  return refreshPickSettlementFromMatches(pick, all, sources, now);
}
