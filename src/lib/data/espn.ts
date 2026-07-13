import type { MarketType, MatchCandidate, TeamStats } from "@/lib/engine/types";
import { fairOdds, marketModelProb } from "@/lib/engine/model";

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

/** Leagues with frequent real fixtures year-round / summer */
export const ESPN_LEAGUES: { slug: string; name: string }[] = [
  { slug: "usa.1", name: "MLS" },
  { slug: "mex.1", name: "Liga MX" },
  { slug: "bra.1", name: "Brasileirão" },
  { slug: "arg.1", name: "Liga Profesional" },
  { slug: "nor.1", name: "Eliteserien" },
  { slug: "swe.1", name: "Allsvenskan" },
  { slug: "den.1", name: "Superliga" },
  { slug: "jpn.1", name: "J1 League" },
  { slug: "kor.1", name: "K League 1" },
  { slug: "aus.1", name: "A-League" },
  { slug: "eng.1", name: "Premier League" },
  { slug: "esp.1", name: "LaLiga" },
  { slug: "ger.1", name: "Bundesliga" },
  { slug: "ita.1", name: "Serie A" },
  { slug: "fra.1", name: "Ligue 1" },
  { slug: "ned.1", name: "Eredivisie" },
  { slug: "por.1", name: "Primeira Liga" },
  { slug: "uefa.champions", name: "Champions League" },
  { slug: "uefa.europa", name: "Europa League" },
];

type EspnCompetitor = {
  homeAway: "home" | "away";
  score?: string;
  form?: string;
  records?: { type?: string; name?: string; summary?: string }[];
  team: { id?: string; displayName: string };
};

type EspnEvent = {
  id: string;
  date: string;
  name?: string;
  status?: {
    type?: {
      state?: string;
      completed?: boolean;
      name?: string;
      detail?: string;
    };
  };
  competitions?: {
    competitors?: EspnCompetitor[];
    odds?: { details?: string; overUnder?: number; spread?: number }[];
    venue?: { fullName?: string };
  }[];
};

function utcDateStamp(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function formToArray(form?: string): number[] {
  if (!form) return [0.5, 0.5, 0.5, 0.5, 0.5];
  return form
    .slice(-5)
    .split("")
    .map((c) => (c === "W" ? 1 : c === "D" ? 0.5 : 0));
}

function parseRecord(summary?: string): { w: number; d: number; l: number } {
  if (!summary) return { w: 0, d: 0, l: 0 };
  const parts = summary.split("-").map((x) => Number(x));
  if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
    return { w: parts[0], d: parts[1], l: parts[2] };
  }
  return { w: 0, d: 0, l: 0 };
}

function statsFromCompetitor(c: EspnCompetitor): TeamStats {
  const rec = parseRecord(
    c.records?.find((r) => r.type === "total" || r.name)?.summary ??
      c.records?.[0]?.summary,
  );
  const played = Math.max(1, rec.w + rec.d + rec.l);
  const winRate = rec.w / played;
  const gfProxy = 0.7 + winRate * 1.4;
  const gaProxy = 1.4 - winRate * 0.9;
  return {
    name: c.team.displayName,
    attack: 0.7 + winRate * 0.9,
    defense: 1.3 - winRate * 0.7,
    form: formToArray(c.form),
    xgFor: gfProxy,
    xgAgainst: Math.max(0.4, gaProxy),
    shotsPerGame: 10 + winRate * 6,
    possession: 45 + winRate * 15,
    restDays: 5,
    injuries: 1,
    motivation: 0.55 + winRate * 0.35,
  };
}

function mapStatus(
  state?: string,
  completed?: boolean,
): MatchCandidate["status"] {
  if (completed || state === "post") return "finished";
  if (state === "in") return "inplay";
  return "scheduled";
}

function buildOdds(
  home: TeamStats,
  away: TeamStats,
  espnOdds?: EspnEvent["competitions"],
): Partial<Record<MarketType, number>> {
  const markets: MarketType[] = [
    "under_35",
    "under_25",
    "double_chance_1x",
    "btts_no",
    "draw_no_bet_home",
    "ah_home_m025",
    "home_win",
    "ah_home_m05",
  ];
  const odds: Partial<Record<MarketType, number>> = {};
  for (const m of markets) {
    const p = marketModelProb(m, home, away);
    odds[m] = fairOdds(p, 0.02);
  }

  // If ESPN provides moneyline-ish details, lightly bias home_win
  const raw = espnOdds?.[0]?.odds?.[0];
  if (raw?.details && typeof raw.details === "string") {
    // leave model odds — ESPN soccer odds often sparse
  }
  return odds;
}

function eventToCandidate(
  event: EspnEvent,
  leagueName: string,
): MatchCandidate | null {
  const comp = event.competitions?.[0];
  const competitors = comp?.competitors;
  if (!competitors || competitors.length < 2) return null;
  const homeC = competitors.find((c) => c.homeAway === "home");
  const awayC = competitors.find((c) => c.homeAway === "away");
  if (!homeC || !awayC) return null;

  const home = statsFromCompetitor(homeC);
  const away = statsFromCompetitor(awayC);
  const status = mapStatus(
    event.status?.type?.state,
    event.status?.type?.completed,
  );
  const homeScore =
    homeC.score != null && homeC.score !== ""
      ? Number(homeC.score)
      : undefined;
  const awayScore =
    awayC.score != null && awayC.score !== ""
      ? Number(awayC.score)
      : undefined;

  const kickoff = new Date(event.date);
  const matchday = kickoff.getUTCDate();

  return {
    id: `espn-${event.id}`,
    externalId: event.id,
    kickoff: event.date,
    kickoffUtc: event.date,
    league: leagueName,
    home,
    away,
    odds: buildOdds(home, away, event.competitions),
    matchday,
    status,
    homeScore: Number.isFinite(homeScore) ? homeScore : undefined,
    awayScore: Number.isFinite(awayScore) ? awayScore : undefined,
    provider: "espn",
  };
}

async function fetchScoreboard(
  slug: string,
  dates?: string,
): Promise<EspnEvent[]> {
  const url = dates
    ? `${ESPN_BASE}/${slug}/scoreboard?dates=${dates}`
    : `${ESPN_BASE}/${slug}/scoreboard`;
  const res = await fetch(url, {
    headers: { "User-Agent": "racha-108/1.0" },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { events?: EspnEvent[] };
  return json.events ?? [];
}

/**
 * Fetch real fixtures from ESPN across major leagues for today ± 2 days UTC.
 * Never invents teams or matches.
 */
export async function fetchEspnMatches(now = new Date()): Promise<MatchCandidate[]> {
  const dates: string[] = [];
  for (let i = -1; i <= 2; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    dates.push(utcDateStamp(d));
  }

  const seen = new Set<string>();
  const out: MatchCandidate[] = [];

  await Promise.all(
    ESPN_LEAGUES.flatMap((league) =>
      // current board + dated boards
      [undefined, ...dates].map(async (date) => {
        try {
          const events = await fetchScoreboard(league.slug, date);
          for (const ev of events) {
            const m = eventToCandidate(ev, league.name);
            if (!m || seen.has(m.id)) continue;
            seen.add(m.id);
            out.push(m);
          }
        } catch {
          // ignore league failures
        }
      }),
    ),
  );

  return out.sort(
    (a, b) =>
      new Date(a.kickoffUtc ?? a.kickoff).getTime() -
      new Date(b.kickoffUtc ?? b.kickoff).getTime(),
  );
}
