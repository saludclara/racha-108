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

    const kick = new Date(m.kickoffUtc ?? m.kickoff).getTime();
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
 * Prefer settleable (live), then expand kickoff windows.
 * Every cycle should still get a real candidate when the feed has fixtures.
 */
export function candidatePoolForCycle(
  candidates: MatchCandidate[],
  now: Date,
): { pool: MatchCandidate[]; tier: "settleable" | "near" | "day" | "wide" } {
  const open = candidates.filter((m) => m.status !== "finished");
  const settleable = settleableForCycle(open, now);
  if (settleable.length) return { pool: settleable, tier: "settleable" };

  const t = now.getTime();
  const windows: { ms: number; tier: "near" | "day" | "wide" }[] = [
    { ms: 6 * 3600_000, tier: "near" },
    { ms: 24 * 3600_000, tier: "day" },
    { ms: 72 * 3600_000, tier: "wide" },
  ];

  for (const { ms, tier } of windows) {
    const filtered = open.filter((m) => {
      if (m.status === "inplay") return true;
      const kick = new Date(m.kickoffUtc ?? m.kickoff).getTime();
      return (
        Number.isFinite(kick) &&
        kick >= t - 2 * 3600_000 &&
        kick <= t + ms
      );
    });
    if (filtered.length) return { pool: filtered, tier };
  }

  return { pool: open, tier: "wide" };
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

  const open = all.filter((m) => m.status !== "finished");
  const { pool, tier } = candidatePoolForCycle(open, now);

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
          : "Sin fixtures abiertos en el feed (todos finalizados).",
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

  const fresh = findMatch(all, pick) ?? pick.match;
  const refreshed: ScoredPick = { ...pick, match: fresh, hourKey };

  if (fresh.status === "finished") {
    const settle = settlePick(refreshed);
    return {
      ok: true,
      hourKey,
      status: "settled",
      pick: refreshed,
      settle,
      matchCount: pool.length,
      sources,
      message: settle
        ? `Resultado real ${fresh.homeScore}-${fresh.awayScore}`
        : "Partido terminado sin marcador legible",
      fetchedAt: now.toISOString(),
    };
  }

  const tierNote =
    tier === "settleable"
      ? "ventana liquidable"
      : tier === "near"
        ? "kickoff ≤6h"
        : tier === "day"
          ? "kickoff ≤24h"
          : "mejor disponible";

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
  const fresh = findMatch(all, pick) ?? null;

  if (!fresh) {
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

  const refreshed: ScoredPick = { ...pick, match: fresh, hourKey: pick.hourKey };
  if (fresh.status === "finished") {
    const settle = settlePick(refreshed);
    return {
      ok: true,
      hourKey: pick.hourKey,
      status: "settled",
      pick: refreshed,
      settle,
      matchCount: all.length,
      sources,
      message: settle
        ? `Resultado real ${fresh.homeScore}-${fresh.awayScore} · HotStack listo`
        : "FT sin marcador",
      fetchedAt: now.toISOString(),
    };
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
