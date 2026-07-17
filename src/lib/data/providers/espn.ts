import { CACHE_TTL, withCache } from "@/lib/data/cache";
import { canonicalIdFor } from "@/lib/data/merge";
import {
  buildModelOdds,
  buildTeamStatsFromForm,
} from "@/lib/data/odds-model";
import type { MatchCandidate, TeamStats } from "@/lib/engine/types";
import type { MatchProvider, ProviderResult } from "./types";

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

/** Expanded free ESPN soccer coverage (no API key). */
export const ESPN_LEAGUES: { slug: string; name: string }[] = [
  // Americas
  { slug: "usa.1", name: "MLS" },
  { slug: "usa.2", name: "USL Championship" },
  { slug: "mex.1", name: "Liga MX" },
  { slug: "bra.1", name: "Brasileirão" },
  { slug: "bra.2", name: "Brasileirão Série B" },
  { slug: "arg.1", name: "Liga Profesional" },
  { slug: "chi.1", name: "Primera División Chile" },
  { slug: "col.1", name: "Liga BetPlay" },
  { slug: "per.1", name: "Liga 1 Perú" },
  { slug: "uru.1", name: "Primera División Uruguay" },
  { slug: "ecu.1", name: "LigaPro" },
  { slug: "par.1", name: "Primera División Paraguay" },
  { slug: "conmebol.libertadores", name: "Copa Libertadores" },
  { slug: "conmebol.sudamericana", name: "Copa Sudamericana" },
  { slug: "concacaf.leagues.cup", name: "Leagues Cup" },
  { slug: "concacaf.champions.cup", name: "Concacaf Champions Cup" },
  // Europe tops + cups
  { slug: "eng.1", name: "Premier League" },
  { slug: "eng.2", name: "Championship" },
  { slug: "eng.3", name: "League One" },
  { slug: "eng.fa", name: "FA Cup" },
  { slug: "eng.league_cup", name: "EFL Cup" },
  { slug: "esp.1", name: "LaLiga" },
  { slug: "esp.2", name: "LaLiga 2" },
  { slug: "ger.1", name: "Bundesliga" },
  { slug: "ger.2", name: "2. Bundesliga" },
  { slug: "ita.1", name: "Serie A" },
  { slug: "ita.2", name: "Serie B" },
  { slug: "fra.1", name: "Ligue 1" },
  { slug: "fra.2", name: "Ligue 2" },
  { slug: "ned.1", name: "Eredivisie" },
  { slug: "por.1", name: "Primeira Liga" },
  { slug: "bel.1", name: "Pro League" },
  { slug: "sco.1", name: "Scottish Premiership" },
  { slug: "tur.1", name: "Süper Lig" },
  { slug: "gre.1", name: "Super League Greece" },
  { slug: "aut.1", name: "Bundesliga AT" },
  { slug: "sui.1", name: "Super League CH" },
  { slug: "rus.1", name: "Russian Premier League" },
  { slug: "ukr.1", name: "Ukrainian Premier League" },
  { slug: "cze.1", name: "Czech First League" },
  { slug: "pol.1", name: "Ekstraklasa" },
  { slug: "rou.1", name: "Liga 1 Romania" },
  { slug: "cro.1", name: "HNL" },
  { slug: "srb.1", name: "SuperLiga Serbia" },
  { slug: "uefa.champions", name: "Champions League" },
  { slug: "uefa.europa", name: "Europa League" },
  { slug: "uefa.europa.conf", name: "Conference League" },
  { slug: "uefa.nations", name: "UEFA Nations League" },
  // Nordic / summer
  { slug: "nor.1", name: "Eliteserien" },
  { slug: "swe.1", name: "Allsvenskan" },
  { slug: "den.1", name: "Superliga" },
  { slug: "fin.1", name: "Veikkausliiga" },
  { slug: "isl.1", name: "Besta deildin" },
  // Asia / Oceania / Africa
  { slug: "jpn.1", name: "J1 League" },
  { slug: "jpn.2", name: "J2 League" },
  { slug: "kor.1", name: "K League 1" },
  { slug: "aus.1", name: "A-League" },
  { slug: "chn.1", name: "Chinese Super League" },
  { slug: "sau.1", name: "Saudi Pro League" },
  { slug: "uae.1", name: "UAE Pro League" },
  { slug: "qat.1", name: "Stars League" },
  { slug: "ind.1", name: "Indian Super League" },
  { slug: "afc.champions", name: "AFC Champions League" },
  { slug: "rsa.1", name: "Premier Soccer League" },
  { slug: "egy.1", name: "Egyptian Premier League" },
];

type EspnCompetitor = {
  homeAway: "home" | "away";
  score?: string;
  form?: string;
  records?: { type?: string; name?: string; summary?: string }[];
  team: { id?: string; displayName: string };
};

type EspnStatus = {
  type?: {
    state?: string;
    completed?: boolean;
    name?: string;
    description?: string;
    detail?: string;
    shortDetail?: string;
  };
};

type EspnEvent = {
  id: string;
  date?: string;
  status?: EspnStatus;
  competitions?: {
    date?: string;
    status?: EspnStatus;
    competitors?: EspnCompetitor[];
    odds?: { details?: string; overUnder?: number; spread?: number }[];
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
  return buildTeamStatsFromForm(c.team.displayName, {
    form: formToArray(c.form),
    winRate,
  });
}

function mapStatus(
  state?: string,
  completed?: boolean,
  name?: string,
  description?: string,
): MatchCandidate["status"] {
  const label = `${name ?? ""} ${description ?? ""}`.toUpperCase();
  // Postponed / suspended — keep open until abandon deadline
  if (/POSTPON|SUSPEND/.test(label)) return "scheduled";
  // Cancelled / abandoned / walkover — void (settle → push sin scores)
  if (/CANCEL|ABANDON|FORFEIT|WALKOVER/.test(label)) return "finished";
  if (completed || state === "post") return "finished";
  if (state === "in") return "inplay";
  return "scheduled";
}

function eventToCandidate(
  event: EspnEvent,
  leagueName: string,
): MatchCandidate | null {
  const competition = event.competitions?.[0];
  const competitors = competition?.competitors;
  if (!competitors || competitors.length < 2) return null;
  const homeC = competitors.find((c) => c.homeAway === "home");
  const awayC = competitors.find((c) => c.homeAway === "away");
  if (!homeC || !awayC) return null;

  const home = statsFromCompetitor(homeC);
  const away = statsFromCompetitor(awayC);
  // Scoreboard: status on event. Summary API: status on competition.
  const st = event.status ?? competition?.status;
  const status = mapStatus(
    st?.type?.state,
    st?.type?.completed,
    st?.type?.name,
    st?.type?.description,
  );
  const homeScore =
    homeC.score != null && homeC.score !== ""
      ? Number(homeC.score)
      : undefined;
  const awayScore =
    awayC.score != null && awayC.score !== ""
      ? Number(awayC.score)
      : undefined;
  const detail = st?.type?.detail ?? st?.type?.description ?? "";
  const minuteMatch = /(\d+)\s*'/.exec(String(detail));
  const minute = minuteMatch ? Number(minuteMatch[1]) : undefined;

  const kickoffIso = event.date ?? competition?.date;
  if (!kickoffIso) return null;
  const kickoff = new Date(kickoffIso);
  const modeled = buildModelOdds(home, away, leagueName);
  const match: MatchCandidate = {
    id: `espn-${event.id}`,
    externalId: event.id,
    kickoff: kickoffIso,
    kickoffUtc: kickoffIso,
    league: leagueName,
    home,
    away,
    odds: modeled.odds,
    oddsSource: modeled.oddsSource,
    matchday: kickoff.getUTCDate(),
    status,
    homeScore: Number.isFinite(homeScore) ? homeScore : undefined,
    awayScore: Number.isFinite(awayScore) ? awayScore : undefined,
    minute: Number.isFinite(minute) ? minute : undefined,
    provider: "espn",
    sport: "football",
    providers: { espn: event.id },
  };
  match.canonicalId = canonicalIdFor(match);
  return match;
}

async function fetchScoreboard(
  slug: string,
  dates?: string,
): Promise<EspnEvent[]> {
  const url = dates
    ? `${ESPN_BASE}/${slug}/scoreboard?dates=${dates}`
    : `${ESPN_BASE}/${slug}/scoreboard`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "racha-108/1.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { events?: EspnEvent[] };
    return json.events ?? [];
  } catch {
    return [];
  }
}

/** Run async tasks with a concurrency cap (Vercel-friendly). */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

async function fetchEspnSummary(
  slug: string,
  eventId: string,
): Promise<EspnEvent | null> {
  try {
    const res = await fetch(
      `${ESPN_BASE}/${slug}/summary?event=${encodeURIComponent(eventId)}`,
      {
        headers: { "User-Agent": "racha-108/1.0" },
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { header?: EspnEvent };
    return json.header ?? null;
  } catch {
    return null;
  }
}

async function loadEspnMatches(now: Date): Promise<MatchCandidate[]> {
  // ±2 days: ESPN boards use US calendar days for overnight kickoffs.
  const dates = [-2, -1, 0, 1, 2].map((i) =>
    utcDateStamp(new Date(now.getTime() + i * 86400000)),
  );
  const jobs = ESPN_LEAGUES.flatMap((league) =>
    [undefined, ...dates].map((date) => ({ league, date })),
  );

  const seen = new Set<string>();
  const out: MatchCandidate[] = [];

  const batches = await mapPool(jobs, 12, async ({ league, date }) => {
    try {
      return await fetchScoreboard(league.slug, date);
    } catch {
      return [] as EspnEvent[];
    }
  });

  for (let i = 0; i < jobs.length; i++) {
    const events = batches[i] ?? [];
    const leagueName = jobs[i].league.name;
    for (const ev of events) {
      const m = eventToCandidate(ev, leagueName);
      if (!m || seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }

  return out.sort(
    (a, b) =>
      new Date(a.kickoffUtc ?? a.kickoff).getTime() -
      new Date(b.kickoffUtc ?? b.kickoff).getTime(),
  );
}

export const espnProvider: MatchProvider = {
  id: "espn",
  label: "ESPN",
  isConfigured: () => true,
  async fetch({ now = new Date() }): Promise<ProviderResult> {
    try {
      const matches = await withCache(
        `espn:${utcDateStamp(now)}:v2`,
        CACHE_TTL.espn,
        () => loadEspnMatches(now),
      );
      return {
        matches,
        status: {
          id: "espn",
          label: "ESPN",
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
          id: "espn",
          label: "ESPN",
          enabled: true,
          configured: true,
          ok: false,
          count: 0,
          error: err instanceof Error ? err.message : "ESPN fetch failed",
        },
      };
    }
  },
  async refreshByExternalId(externalId, opts) {
    const id = externalId.trim();
    if (!id) return null;
    const preferred = ESPN_LEAGUES.find((l) => l.name === opts?.leagueHint);
    const order = preferred
      ? [preferred, ...ESPN_LEAGUES.filter((l) => l.slug !== preferred.slug)]
      : ESPN_LEAGUES;

    // Probe preferred league first, then fan-out (settle must not miss FT)
    for (const league of order.slice(0, 8)) {
      const header = await fetchEspnSummary(league.slug, id);
      const m = header ? eventToCandidate(header, league.name) : null;
      if (m) return m;
    }
    const rest = await mapPool(order.slice(8), 10, async (league) => {
      const header = await fetchEspnSummary(league.slug, id);
      return header ? eventToCandidate(header, league.name) : null;
    });
    return rest.find((m) => m != null) ?? null;
  },
};

/** Back-compat helper used by older imports. */
export async function fetchEspnMatches(
  now = new Date(),
): Promise<MatchCandidate[]> {
  const { matches } = await espnProvider.fetch({ now });
  return matches;
}
