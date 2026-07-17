import { mergeMatches } from "@/lib/data/merge";
import type { MatchCandidate, ScoredPick } from "@/lib/engine/types";
import { apiFootballProvider } from "./api-football";
import { espnProvider } from "./espn";
import { oddsApiProvider } from "./odds-api";
import { pandascoreProvider } from "./pandascore";
import type { FetchOptions, SourceStatus } from "./types";

const ALL = [
  espnProvider,
  apiFootballProvider,
  oddsApiProvider,
  pandascoreProvider,
] as const;

export type AggregatedFeed = {
  matches: MatchCandidate[];
  sources: SourceStatus[];
};

/**
 * Fetch + merge all enabled free providers.
 * ESPN always runs; optional keys power the rest.
 */
export async function fetchAllMatches(
  opts: FetchOptions = {},
): Promise<AggregatedFeed> {
  const results = await Promise.all(ALL.map((p) => p.fetch(opts)));
  const matches = mergeMatches(results.map((r) => r.matches));
  return {
    matches,
    sources: results.map((r) => r.status),
  };
}

/**
 * Direct per-event lookup — bypasses scoreboard date windows / cache.
 * Used so pending picks always get a real FT when the provider still has it.
 */
export async function refreshMatchForPick(
  pick: ScoredPick,
  opts: FetchOptions = {},
): Promise<MatchCandidate | null> {
  const ids = new Set<string>();
  if (pick.match.externalId) ids.add(pick.match.externalId);
  for (const v of Object.values(pick.match.providers ?? {})) {
    if (v) ids.add(v);
  }
  // espn-401… / af-123…
  const bare = pick.match.id.replace(/^(espn|af)-/, "");
  if (bare) ids.add(bare);

  const leagueHint = pick.match.league;
  const providers = ALL.filter((p) => p.refreshByExternalId);

  for (const id of ids) {
    for (const p of providers) {
      if (p.id === "api-football" && opts.enableApiFootball === false) continue;
      try {
        const m = await p.refreshByExternalId?.(id, {
          ...opts,
          leagueHint,
        });
        if (m) return m;
      } catch {
        // try next
      }
    }
  }
  return null;
}

export function providerConfigSummary(): SourceStatus[] {
  return ALL.map((p) => ({
    id: p.id,
    label: p.label,
    enabled: true,
    configured: p.isConfigured(),
    ok: p.isConfigured(),
    count: 0,
  }));
}
