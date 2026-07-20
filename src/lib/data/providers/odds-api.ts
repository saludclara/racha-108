import { CACHE_TTL, withCache } from "@/lib/data/cache";
import { canonicalIdFor } from "@/lib/data/merge";
import {
  buildTeamStatsFromForm,
  markBookOdds,
} from "@/lib/data/odds-model";
import type { MarketType, MatchCandidate } from "@/lib/engine/types";
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

/** Prefer shortest book price (conservative for edge). */
function takeShorter(
  cur: number | undefined,
  price: number,
): number {
  return Math.min(cur ?? 99, price);
}

/**
 * Derive DC 1X / DNB from h2h book prices (de-vigged).
 * Still tagged book — sourced from real bookmaker h2h, not model.
 */
function deriveFromH2h(
  homePrice: number,
  drawPrice: number,
  awayPrice: number | undefined,
): Partial<Record<MarketType, number>> {
  const pH = 1 / homePrice;
  const pD = 1 / drawPrice;
  const pA = awayPrice != null && awayPrice > 1 ? 1 / awayPrice : 0;
  const sum = pH + pD + pA;
  if (!(sum > 0)) return {};
  const fH = pH / sum;
  const fD = pD / sum;
  const fA = pA / sum;
  const out: Partial<Record<MarketType, number>> = {};
  const dc = 1 / (fH + fD);
  if (Number.isFinite(dc) && dc > 1) out.double_chance_1x = dc;
  if (fH > 0 && fA >= 0) {
    const dnb = 1 / (fH / (fH + fA));
    if (Number.isFinite(dnb) && dnb > 1) out.draw_no_bet_home = dnb;
  }
  return out;
}

/** Map bookmaker markets into grind MarketTypes (band filtered later in score). */
function extractGrindOdds(
  event: OddsEvent,
): Partial<Record<MarketType, number>> {
  const odds: Partial<Record<MarketType, number>> = {};
  const books = event.bookmakers ?? [];

  for (const book of books) {
    for (const market of book.markets) {
      if (market.key === "h2h") {
        const home = market.outcomes.find((o) => o.name === event.home_team);
        const draw = market.outcomes.find(
          (o) => o.name.toLowerCase() === "draw",
        );
        const away = market.outcomes.find((o) => o.name === event.away_team);
        if (home && home.price > 1) {
          odds.home_win = takeShorter(odds.home_win, home.price);
        }
        if (home && draw && home.price > 1 && draw.price > 1) {
          const derived = deriveFromH2h(
            home.price,
            draw.price,
            away?.price,
          );
          if (derived.double_chance_1x != null) {
            odds.double_chance_1x = takeShorter(
              odds.double_chance_1x,
              derived.double_chance_1x,
            );
          }
          if (derived.draw_no_bet_home != null) {
            odds.draw_no_bet_home = takeShorter(
              odds.draw_no_bet_home,
              derived.draw_no_bet_home,
            );
          }
        }
      }

      if (market.key === "totals") {
        for (const o of market.outcomes) {
          if (o.name.toLowerCase() !== "under" || o.point == null) continue;
          if (o.price <= 1) continue;
          if (o.point === 3.5) {
            odds.under_35 = takeShorter(odds.under_35, o.price);
          }
          if (o.point === 2.5) {
            odds.under_25 = takeShorter(odds.under_25, o.price);
          }
        }
      }

      if (market.key === "spreads") {
        const home = market.outcomes.find((o) => o.name === event.home_team);
        if (!home || home.price <= 1 || home.point == null) continue;
        if (home.point === -0.5) {
          odds.ah_home_m05 = takeShorter(odds.ah_home_m05, home.price);
        }
        if (home.point === -0.25) {
          odds.ah_home_m025 = takeShorter(odds.ah_home_m025, home.price);
        }
        // Point 0 ≈ DNB home when spreads offer it
        if (home.point === 0) {
          odds.draw_no_bet_home = takeShorter(
            odds.draw_no_bet_home,
            home.price,
          );
        }
      }

      if (market.key === "btts") {
        const no = market.outcomes.find((o) => o.name.toLowerCase() === "no");
        if (no && no.price > 1) {
          odds.btts_no = takeShorter(odds.btts_no, no.price);
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

/**
 * Curated free-tier set — 1 credit unit = markets × regions per sport.
 * regions=eu only + 12 sports × (h2h,totals,spreads) ≈ same burn as old 6×3×2.
 */
const SOCCER_SPORTS = [
  "soccer_epl",
  "soccer_spain_la_liga",
  "soccer_italy_serie_a",
  "soccer_germany_bundesliga",
  "soccer_france_ligue_one",
  "soccer_netherlands_eredivisie",
  "soccer_usa_mls",
  "soccer_australia_aleague",
  "soccer_mexico_ligamx",
  "soccer_brazil_campeonato",
  "soccer_uefa_champs_league",
  "soccer_efl_champ",
] as const;

async function fetchSoccerOdds(key: string): Promise<MatchCandidate[]> {
  const seen = new Set<string>();
  const out: MatchCandidate[] = [];
  let lastError: string | undefined;

  await Promise.all(
    SOCCER_SPORTS.map(async (sport) => {
      try {
        const url =
          `${BASE}/sports/${sport}/odds?regions=eu&markets=h2h,totals,spreads&oddsFormat=decimal&apiKey=${encodeURIComponent(key)}`;
        const res = await fetch(url, {
          headers: { "User-Agent": "racha-108/1.0" },
          cache: "no-store",
        });
        const body: unknown = await res.json();
        if (!res.ok) {
          const msg =
            typeof body === "object" &&
            body &&
            "message" in body &&
            typeof (body as { message: unknown }).message === "string"
              ? (body as { message: string }).message
              : `HTTP ${res.status}`;
          throw new Error(msg);
        }
        if (!Array.isArray(body)) {
          const msg =
            typeof body === "object" &&
            body &&
            "message" in body &&
            typeof (body as { message: unknown }).message === "string"
              ? (body as { message: string }).message
              : "Odds API: respuesta inválida";
          throw new Error(msg);
        }
        const events = body as OddsEvent[];
        for (const ev of events) {
          const m = toCandidate({ ...ev, sport_key: sport });
          if (!m || seen.has(m.id)) continue;
          seen.add(m.id);
          out.push(m);
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : "Odds API failed";
      }
    }),
  );

  if (!out.length && lastError) {
    throw new Error(lastError);
  }

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
        "odds:soccer:v2",
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
