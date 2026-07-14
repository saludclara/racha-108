import { CACHE_TTL, withCache } from "@/lib/data/cache";
import { canonicalIdFor } from "@/lib/data/merge";
import { buildModelOdds, proxyTeamStats } from "@/lib/data/odds-model";
import type { MatchCandidate } from "@/lib/engine/types";
import type { FetchOptions, MatchProvider, ProviderResult } from "./types";

const BASE = "https://v3.football.api-sports.io";

function apiKey(): string | undefined {
  return process.env.API_FOOTBALL_KEY || process.env.APISPORTS_KEY;
}

type AfFixture = {
  fixture: {
    id: number;
    date: string;
    status: { short: string; long?: string };
  };
  league: { name: string; round?: string };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: { home: number | null; away: number | null };
};

function mapStatus(short: string): MatchCandidate["status"] {
  const s = short.toUpperCase();
  if (["FT", "AET", "PEN"].includes(s)) return "finished";
  if (["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "INT"].includes(s))
    return "inplay";
  return "scheduled";
}

function toCandidate(row: AfFixture): MatchCandidate {
  const home = proxyTeamStats(row.teams.home.name, { winRate: 0.48 });
  const away = proxyTeamStats(row.teams.away.name, { winRate: 0.42 });
  const kickoff = row.fixture.date;
  const status = mapStatus(row.fixture.status.short);
  const roundNum = Number(String(row.league.round ?? "").replace(/\D/g, ""));
  const match: MatchCandidate = {
    id: `af-${row.fixture.id}`,
    externalId: String(row.fixture.id),
    kickoff,
    kickoffUtc: kickoff,
    league: row.league.name,
    home,
    away,
    odds: buildModelOdds(home, away),
    matchday: Number.isFinite(roundNum) ? roundNum : new Date(kickoff).getUTCDate(),
    status,
    homeScore: row.goals.home ?? undefined,
    awayScore: row.goals.away ?? undefined,
    provider: "api-football",
    sport: "football",
    providers: { "api-football": String(row.fixture.id) },
  };
  match.canonicalId = canonicalIdFor(match);
  return match;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchFixturesForDate(
  date: string,
  key: string,
): Promise<AfFixture[]> {
  const res = await fetch(`${BASE}/fixtures?date=${date}`, {
    headers: {
      "x-apisports-key": key,
      "User-Agent": "racha-108/1.0",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`API-Football HTTP ${res.status}`);
  const json = (await res.json()) as { response?: AfFixture[]; errors?: unknown };
  if (json.errors && Object.keys(json.errors as object).length) {
    throw new Error("API-Football rate/limit error");
  }
  return json.response ?? [];
}

async function loadApiFootball(now: Date, key: string): Promise<MatchCandidate[]> {
  const dates = [0, 1].map((i) => ymd(new Date(now.getTime() + i * 86400000)));
  const seen = new Set<string>();
  const out: MatchCandidate[] = [];

  for (const date of dates) {
    const rows = await withCache(
      `af:fixtures:${date}`,
      CACHE_TTL.apiFootball,
      () => fetchFixturesForDate(date, key),
    );
    for (const row of rows) {
      const m = toCandidate(row);
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

export const apiFootballProvider: MatchProvider = {
  id: "api-football",
  label: "API-Football",
  isConfigured: () => Boolean(apiKey()),
  async fetch(opts: FetchOptions): Promise<ProviderResult> {
    const enabled = opts.enableApiFootball !== false;
    const key = apiKey();
    if (!enabled) {
      return {
        matches: [],
        status: {
          id: "api-football",
          label: "API-Football",
          enabled: false,
          configured: Boolean(key),
          ok: true,
          count: 0,
        },
      };
    }
    if (!key) {
      return {
        matches: [],
        status: {
          id: "api-football",
          label: "API-Football",
          enabled: true,
          configured: false,
          ok: false,
          count: 0,
          error: "Falta API_FOOTBALL_KEY (plan free)",
        },
      };
    }

    try {
      const matches = await loadApiFootball(opts.now ?? new Date(), key);
      return {
        matches,
        status: {
          id: "api-football",
          label: "API-Football",
          enabled: true,
          configured: true,
          ok: true,
          count: matches.length,
        },
      };
    } catch (err) {
      return {
        matches: [],
        status: {
          id: "api-football",
          label: "API-Football",
          enabled: true,
          configured: true,
          ok: false,
          count: 0,
          error: err instanceof Error ? err.message : "API-Football failed",
        },
      };
    }
  },
};
