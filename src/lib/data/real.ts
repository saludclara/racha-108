import {
  fetchAllMatches,
  refreshMatchForPick,
} from "@/lib/data/providers/registry";
import type { SourceStatus } from "@/lib/data/providers/types";
import { CYCLE_MS } from "@/lib/engine/schedule";
import { pickBestForHour, type PickBestOptions } from "@/lib/engine/score";
import { settleFromScores, settlePick } from "@/lib/engine/settle";
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
 * At abandon deadline, force finished whenever scores exist (never push-with-score).
 */
function withInferredFinish(
  match: MatchCandidate,
  now: Date,
  force = false,
): MatchCandidate {
  if (match.status === "finished") return match;
  if (match.homeScore == null || match.awayScore == null) return match;
  const kick = kickoffMs(match);
  if (!Number.isFinite(kick)) return match;
  const readyAt = kick + estimatedMatchMs(match);
  if (!force && now.getTime() < readyAt) return match;
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
  const finished = { ...fresh, status: "finished" as const };
  const refreshed: ScoredPick = {
    ...pick,
    match: finished,
    hourKey: pick.hourKey,
  };
  const settle =
    settlePick(refreshed) ??
    settleFromScores(pick.market, finished.homeScore, finished.awayScore);
  if (settle) {
    return settledResponse(
      pick.hourKey,
      refreshed,
      settle,
      matchCount,
      sources,
      `Resultado real ${finished.homeScore}-${finished.awayScore} · HotStack listo`,
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

/**
 * Guarantee a terminal outcome: win/loss if scores exist, else push.
 * Never leaves a pick unresolved past the abandon window.
 */
function guaranteeSettle(
  pick: ScoredPick,
  fresh: MatchCandidate | null,
  matchCount: number,
  sources: SourceStatus[],
  now: Date,
  reason: string,
): HourlyPickResponse {
  const base = fresh ?? pick.match;
  const scored = withInferredFinish(base, now, true);
  if (scored.homeScore != null && scored.awayScore != null) {
    return trySettleFinished(pick, scored, matchCount, sources, now);
  }
  // Last chance: scores already on the pending pick from live updates
  const held = withInferredFinish(pick.match, now, true);
  if (held.homeScore != null && held.awayScore != null) {
    return trySettleFinished(pick, held, matchCount, sources, now);
  }
  const refreshed: ScoredPick = {
    ...pick,
    match: { ...base, status: "finished" },
    hourKey: pick.hourKey,
  };
  return settledResponse(
    pick.hourKey,
    refreshed,
    "push",
    matchCount,
    sources,
    reason,
    now,
  );
}

export type MatchFeedSnapshot = {
  matches: MatchCandidate[];
  sources: SourceStatus[];
};

export type HourlyPickOpts = PickBestOptions;

/** Pure pick builder over an already-fetched feed (cron reuses one snapshot). */
export function buildHourlyPickFromMatches(
  hourKey: string,
  threshold: number,
  all: MatchCandidate[],
  sources: SourceStatus[],
  now = new Date(),
  pickOpts: HourlyPickOpts = {},
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

  // Shadow week default: guarantee on + log EV SKIP (see pickBestForHour).
  // Set MOTOR_GUARANTEE=0 to enable real quality SKIP.
  const pick = pickBestForHour(pool, hourKey, threshold, now, pickOpts);

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
        "SKIP de calidad · sin edge/prob suficientes en la ventana liquidable. HotStack intacto.",
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
  const shadowBit =
    refreshed.shadowWouldSkip === true
      ? " · shadow: EV SKIP"
      : refreshed.shadowNote?.startsWith("Shadow: EV alt")
        ? " · shadow: EV alt"
        : "";

  return {
    ok: true,
    hourKey,
    status: "pending",
    pick: refreshed,
    settle: null,
    matchCount: pool.length,
    sources,
    message: `Pick del ciclo · ${tierNote} · ${fresh.status === "inplay" ? "en juego" : "kickoff"} ${new Date(fresh.kickoffUtc ?? fresh.kickoff).toLocaleString("es-AU")}${shadowBit}`,
    fetchedAt: now.toISOString(),
  };
}

export async function buildHourlyPick(
  hourKey: string,
  threshold: number,
  now = new Date(),
  feed: FeedOptions = {},
  pickOpts: HourlyPickOpts = {},
): Promise<HourlyPickResponse> {
  const { matches: all, sources } = await fetchAllMatches({
    now,
    ...feed,
  });
  return buildHourlyPickFromMatches(
    hourKey,
    threshold,
    all,
    sources,
    now,
    pickOpts,
  );
}

/** Pure settlement refresh over an already-fetched feed. */
export function refreshPickSettlementFromMatches(
  pick: ScoredPick,
  all: MatchCandidate[],
  sources: SourceStatus[],
  now = new Date(),
): HourlyPickResponse {
  const found = findMatch(all, pick) ?? null;
  const abandon = shouldAbandonPick(pick, now);
  const fresh = found
    ? withInferredFinish(found, now, abandon)
    : null;

  if (!fresh) {
    if (abandon) {
      return guaranteeSettle(
        pick,
        null,
        all.length,
        sources,
        now,
        "Partido fuera del feed · liquidación garantizada",
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

  // Past abandon: ALWAYS terminal — prefer scores over blank push
  if (abandon || shouldAbandonPick(refreshed, now)) {
    const far =
      (fresh.status ?? "scheduled") === "scheduled" &&
      kickoffMs(fresh) - now.getTime() > NEAR_KICKOFF_MS;
    return guaranteeSettle(
      refreshed,
      fresh,
      all.length,
      sources,
      now,
      far
        ? "Pick fuera de ventana liquidable · liquidación garantizada"
        : `Sin FT oficial a tiempo (${fresh.status}) · liquidación garantizada`,
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

function mergeDirect(
  all: MatchCandidate[],
  direct: MatchCandidate,
): MatchCandidate[] {
  const merged = [...all];
  const idx = merged.findIndex(
    (m) =>
      m.id === direct.id ||
      (direct.externalId && m.externalId === direct.externalId) ||
      (direct.canonicalId && m.canonicalId === direct.canonicalId),
  );
  if (idx >= 0) merged[idx] = direct;
  else merged.push(direct);
  return merged;
}

/**
 * Snapshot → direct event lookup → abandon guarantee.
 * Prefer this in cron (reuses the shared board feed).
 */
export async function settlePendingAgainstSnapshot(
  pick: ScoredPick,
  snapshot: MatchFeedSnapshot,
  now = new Date(),
  feed: FeedOptions = {},
): Promise<HourlyPickResponse> {
  let result = refreshPickSettlementFromMatches(
    pick,
    snapshot.matches,
    snapshot.sources,
    now,
  );
  if (result.status === "settled") return result;

  const direct = await refreshMatchForPick(pick, { now, ...feed });
  if (direct) {
    result = refreshPickSettlementFromMatches(
      pick,
      mergeDirect(snapshot.matches, direct),
      snapshot.sources,
      now,
    );
    if (result.status === "settled") return result;
  }

  if (shouldAbandonPick(result.pick ?? pick, now)) {
    return guaranteeSettle(
      result.pick ?? pick,
      direct,
      snapshot.matches.length,
      snapshot.sources,
      now,
      "Liquidación forzada · HotStack liberado",
    );
  }

  return result;
}

/**
 * Hard settlement path: board snapshot → direct event lookup → guarantee.
 * Every pending pick eventually resolves to win | loss | push.
 */
export async function refreshPickSettlement(
  pick: ScoredPick,
  now = new Date(),
  feed: FeedOptions = {},
): Promise<HourlyPickResponse> {
  const snapshot = await fetchAllMatches({
    now,
    ...feed,
  });
  return settlePendingAgainstSnapshot(pick, snapshot, now, feed);
}
