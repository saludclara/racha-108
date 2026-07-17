import { CACHE_TTL, withCache } from "@/lib/data/cache";
import { canonicalIdFor } from "@/lib/data/merge";
import {
  buildModelOdds,
  buildTeamStatsFromForm,
} from "@/lib/data/odds-model";
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

function formAvg(form: number[]): number {
  if (!form.length) return 0.5;
  let w = 0;
  let s = 0;
  form.forEach((v, i) => {
    const weight = i + 1;
    s += v * weight;
    w += weight;
  });
  return s / Math.max(1, w);
}

/** Win/loss form from finished rows already in the fetch batch. */
function formByTeamName(rows: PsMatch[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  const push = (name: string, pts: number) => {
    const list = map.get(name) ?? [];
    list.push(pts);
    map.set(name, list.slice(-10));
  };

  for (const row of rows) {
    if (mapStatus(row.status) !== "finished") continue;
    const opps = row.opponents ?? [];
    if (opps.length < 2) continue;
    const homeName = teamName(opps, 0);
    const awayName = teamName(opps, 1);
    const homeId = opps[0]?.opponent?.id;
    const awayId = opps[1]?.opponent?.id;
    if (row.winner_id != null && homeId != null && awayId != null) {
      if (row.winner_id === homeId) {
        push(homeName, 1);
        push(awayName, 0);
      } else if (row.winner_id === awayId) {
        push(homeName, 0);
        push(awayName, 1);
      }
      continue;
    }
    if (!row.results?.length || homeId == null || awayId == null) continue;
    const hs = row.results.find((r) => r.team_id === homeId)?.score;
    const asx = row.results.find((r) => r.team_id === awayId)?.score;
    if (hs == null || asx == null) continue;
    if (hs > asx) {
      push(homeName, 1);
      push(awayName, 0);
    } else if (hs < asx) {
      push(homeName, 0);
      push(awayName, 1);
    } else {
      push(homeName, 0.5);
      push(awayName, 0.5);
    }
  }
  return map;
}

function toCandidate(
  row: PsMatch,
  formMap: Map<string, number[]>,
): MatchCandidate | null {
  const opps = row.opponents ?? [];
  if (opps.length < 2) return null;
  const kickoff = row.begin_at || row.scheduled_at;
  if (!kickoff) return null;

  const homeName = teamName(opps, 0);
  const awayName = teamName(opps, 1);
  const homeForm = formMap.get(homeName);
  const awayForm = formMap.get(awayName);
  const home = buildTeamStatsFromForm(homeName, {
    form: homeForm?.length ? homeForm : undefined,
    winRate: homeForm?.length ? formAvg(homeForm) : 0.5,
  });
  const away = buildTeamStatsFromForm(awayName, {
    form: awayForm?.length ? awayForm : undefined,
    winRate: awayForm?.length ? formAvg(awayForm) : 0.48,
  });

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
  const modeled = buildModelOdds(home, away, league);

  const match: MatchCandidate = {
    id: `ps-${row.id}`,
    externalId: String(row.id),
    kickoff,
    kickoffUtc: kickoff,
    league: `${row.videogame?.name ? `${row.videogame.name} · ` : ""}${league}`,
    home,
    away,
    odds: modeled.odds,
    oddsSource: modeled.oddsSource,
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
    "/matches/past?per_page=40",
  ];

  const allRows: PsMatch[] = [];

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
        allRows.push(...rows);
      } catch {
        // ignore endpoint failures
      }
    }),
  );

  const formMap = formByTeamName(allRows);
  const seen = new Set<string>();
  const out: MatchCandidate[] = [];

  for (const row of allRows) {
    // Past board is only for form — do not offer finished as new picks
    if (mapStatus(row.status) === "finished") continue;
    const m = toCandidate(row, formMap);
    if (!m || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }

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
