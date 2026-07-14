import { CACHE_TTL, withCache } from "@/lib/data/cache";
import { canonicalIdFor } from "@/lib/data/merge";
import { buildModelOdds, proxyTeamStats } from "@/lib/data/odds-model";
import type { MatchCandidate } from "@/lib/engine/types";
import type { FetchOptions, MatchProvider, ProviderResult } from "./types";

const BASE = "https://api.pandascore.co";

function apiToken(): string | undefined {
  return process.env.PANDASCORE_TOKEN || process.env.PANDASCORE_API_KEY;
}

type PsOpponent = {
  type?: string;
  opponent?: { id?: number; name?: string; acronym?: string };
};

type PsMatch = {
  id: number;
  name?: string;
  begin_at?: string | null;
  scheduled_at?: string | null;
  status?: string;
  number_of_games?: number;
  videogame?: { name?: string; slug?: string };
  league?: { name?: string };
  tournament?: { name?: string };
  opponents?: PsOpponent[];
  results?: { team_id?: number; score?: number }[];
  winner_id?: number | null;
};

function mapStatus(status?: string): MatchCandidate["status"] {
  const s = (status ?? "").toLowerCase();
  if (s === "finished" || s === "completed") return "finished";
  if (s === "running" || s === "live") return "inplay";
  return "scheduled";
}

function teamName(opps: PsOpponent[], index: number): string {
  const o = opps[index]?.opponent;
  return o?.name || o?.acronym || `Team ${index + 1}`;
}

function toCandidate(row: PsMatch): MatchCandidate | null {
  const opps = row.opponents ?? [];
  if (opps.length < 2) return null;
  const kickoff = row.begin_at || row.scheduled_at;
  if (!kickoff) return null;

  const homeName = teamName(opps, 0);
  const awayName = teamName(opps, 1);
  const home = proxyTeamStats(homeName, { winRate: 0.5 });
  const away = proxyTeamStats(awayName, { winRate: 0.48 });

  const league =
    row.league?.name ||
    row.tournament?.name ||
    row.videogame?.name ||
    "Esports";

  let homeScore: number | undefined;
  let awayScore: number | undefined;
  if (row.results?.length) {
    const homeId = opps[0]?.opponent?.id;
    const awayId = opps[1]?.opponent?.id;
    homeScore = row.results.find((r) => r.team_id === homeId)?.score;
    awayScore = row.results.find((r) => r.team_id === awayId)?.score;
  }

  // Esports: reuse home_win as match-winner grind market via model odds
  const odds = buildModelOdds(home, away);

  const match: MatchCandidate = {
    id: `ps-${row.id}`,
    externalId: String(row.id),
    kickoff,
    kickoffUtc: kickoff,
    league: `${row.videogame?.name ? `${row.videogame.name} · ` : ""}${league}`,
    home,
    away,
    odds,
    matchday: new Date(kickoff).getUTCDate(),
    status: mapStatus(row.status),
    homeScore,
    awayScore,
    provider: "pandascore",
    sport: "esports",
    providers: { pandascore: String(row.id) },
  };
  match.canonicalId = canonicalIdFor(match);
  return match;
}

async function fetchUpcoming(token: string): Promise<MatchCandidate[]> {
  const endpoints = [
    "/csgo/matches/upcoming?per_page=50",
    "/lol/matches/upcoming?per_page=50",
    "/dota2/matches/upcoming?per_page=50",
    "/valorant/matches/upcoming?per_page=50",
    "/matches/running?per_page=40",
  ];

  const seen = new Set<string>();
  const out: MatchCandidate[] = [];

  await Promise.all(
    endpoints.map(async (path) => {
      try {
        const res = await fetch(`${BASE}${path}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "User-Agent": "racha-108/1.0",
          },
          cache: "no-store",
        });
        if (!res.ok) return;
        const rows = (await res.json()) as PsMatch[];
        for (const row of rows) {
          const m = toCandidate(row);
          if (!m || seen.has(m.id)) continue;
          seen.add(m.id);
          out.push(m);
        }
      } catch {
        // ignore endpoint failures
      }
    }),
  );

  return out;
}

export const pandascoreProvider: MatchProvider = {
  id: "pandascore",
  label: "PandaScore",
  isConfigured: () => Boolean(apiToken()),
  async fetch(opts: FetchOptions): Promise<ProviderResult> {
    const enabled = opts.enableEsports !== false;
    const token = apiToken();
    if (!enabled) {
      return {
        matches: [],
        status: {
          id: "pandascore",
          label: "PandaScore",
          enabled: false,
          configured: Boolean(token),
          ok: true,
          count: 0,
        },
      };
    }
    if (!token) {
      return {
        matches: [],
        status: {
          id: "pandascore",
          label: "PandaScore",
          enabled: true,
          configured: false,
          ok: false,
          count: 0,
          error: "Falta PANDASCORE_TOKEN (plan free fixtures)",
        },
      };
    }

    try {
      const matches = await withCache(
        "ps:upcoming",
        CACHE_TTL.pandascore,
        () => fetchUpcoming(token),
      );
      return {
        matches,
        status: {
          id: "pandascore",
          label: "PandaScore",
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
          id: "pandascore",
          label: "PandaScore",
          enabled: true,
          configured: true,
          ok: false,
          count: 0,
          error: err instanceof Error ? err.message : "PandaScore failed",
        },
      };
    }
  },
};
