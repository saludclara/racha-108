import { mergeMatches } from "@/lib/data/merge";
import type { MatchCandidate } from "@/lib/engine/types";
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
