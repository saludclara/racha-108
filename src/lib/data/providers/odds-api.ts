import { CACHE_TTL, withCache } from "@/lib/data/cache";
import { canonicalIdFor } from "@/lib/data/merge";
import {
  buildTeamStatsFromForm,
  markBookOdds,
} from "@/lib/data/odds-model";
import {
  MAX_ODDS,
  MIN_ODDS,
  type MarketType,
  type MatchCandidate,
} from "@/lib/engine/types";
import type { FetchOptions, MatchProvider, ProviderResult } from "./types";

const BASE = "https://api.the-odds-api.com/v4";

function apiKey(): string | undefined {
  return process.env.ODDS_API_KEY || process.env.THE_ODDS_API_KEY;
}

type OddsOutcome = { name: string; price: number; point?: number };
type OddsMarket = { key: string; outcomes: OddsOutcome[] };
type OddsBookmaker = { key: string; markets: OddsMarket[] };
type OddsEvent = {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: OddsBookmaker[];
};

/** Map bookmaker markets into our grind MarketTypes when possible. */
function extractGrindOdds(
  event: OddsEvent,
): Partial<Record<MarketType, number>> {
  const odds: Partial<Record<MarketType, number>> = {};
  const books = event.bookmakers ?? [];
  for (const book of books) {
    for (const market of book.markets) {
      if (market.key === "h2h") {
        const home = market.outcomes.find((o) => o.name === event.home_team);
        if (home && home.price >= MIN_ODDS && home.price <= MAX_ODDS) {
          odds.home_win = Math.min(odds.home_win ?? 99, home.price);
        }
      }
      if (market.key === "totals") {
        for (const o of market.outcomes) {
          if (o.name.toLowerCase() !== "under" || o.point == null) continue;
          if (o.point === 3.5 && o.price >= MIN_ODDS && o.price <= MAX_ODDS) {
            odds.under_35 = Math.min(odds.under_35 ?? 99, o.price);
          }
          if (o.point === 2.5 && o.price >= MIN_ODDS && o.price <= MAX_ODDS) {
            odds.under_25 = Math.min(odds.under_25 ?? 99, o.price);
          }
        }
      }
    }
  }
  return odds;
}

function toCandidate(event: OddsEvent): MatchCandidate | null {
  const grind = extractGrindOdds(event);
  if (!Object.keys(grind).length) return null;

  const home = buildTeamStatsFromForm(event.home_team, { winRate: 0.5 });
  const away = buildTeamStatsFromForm(event.away_team, { winRate: 0.45 });
  const match: MatchCandidate = {
    id: `odds-${event.id}`,
    externalId: event.id,
    kickoff: event.commence_time,
    kickoffUtc: event.commence_time,
    league: event.sport_key.replace(/_/g, " "),
    home,
    away,
    odds: grind,
    oddsSource: markBookOdds(grind),
    matchday: new Date(event.commence_time).getUTCDate(),
    status: "scheduled",
    provider: "odds-api",
    sport: "football",
    providers: { "odds-api": event.id },
  };
  match.canonicalId = canonicalIdFor(match);
  return match;
}

async function fetchSoccerOdds(key: string): Promise<MatchCandidate[]> {
  // Curated free-tier set (1 credit per sport). Cache keeps monthly quota safe.
  const sports = [
    "soccer_epl",
    "soccer_spain_la_liga",
    "soccer_usa_mls",
    "soccer_australia_aleague",
    "soccer_uefa_champs_league",
    "soccer_germany_bundesliga",
  ];

  const seen = new Set<string>();
  const out: MatchCandidate[] = [];

  await Promise.all(
    sports.map(async (sport) => {
      try {
        const url =
          `${BASE}/sports/${sport}/odds?regions=au,eu,uk&markets=h2h,totals&oddsFormat=decimal&apiKey=${encodeURIComponent(key)}`;
        const res = await fetch(url, {
          headers: { "User-Agent": "racha-108/1.0" },
          cache: "no-store",
        });
        if (!res.ok) return;
        const events = (await res.json()) as OddsEvent[];
        for (const ev of events) {
          const m = toCandidate({ ...ev, sport_key: sport });
          if (!m || seen.has(m.id)) continue;
          seen.add(m.id);
          out.push(m);
        }
      } catch {
        // ignore sport failures
      }
    }),
  );

  return out;
}

export const oddsApiProvider: MatchProvider = {
  id: "odds-api",
  label: "The Odds API",
  isConfigured: () => Boolean(apiKey()),
  async fetch(opts: FetchOptions): Promise<ProviderResult> {
    const enabled = opts.enableOddsApi !== false;
    const key = apiKey();
    if (!enabled) {
      return {
        matches: [],
        status: {
          id: "odds-api",
          label: "The Odds API",
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
          id: "odds-api",
          label: "The Odds API",
          enabled: true,
          configured: false,
          ok: false,
          count: 0,
          error: "Falta ODDS_API_KEY (plan free)",
        },
      };
    }

    try {
      const matches = await withCache(
        "odds:soccer",
        CACHE_TTL.oddsApi,
        () => fetchSoccerOdds(key),
      );
      return {
        matches,
        status: {
          id: "odds-api",
          label: "The Odds API",
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
          id: "odds-api",
          label: "The Odds API",
          enabled: true,
          configured: true,
          ok: false,
          count: 0,
          error: err instanceof Error ? err.message : "Odds API failed",
        },
      };
    }
  },
};
