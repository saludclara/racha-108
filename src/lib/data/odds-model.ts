import { fairOdds, marketModelProb } from "@/lib/engine/model";
import type {
  MarketType,
  MatchCandidate,
  OddsSource,
  TeamStats,
} from "@/lib/engine/types";

const MARKETS: MarketType[] = [
  "under_35",
  "under_25",
  "double_chance_1x",
  "btts_no",
  "draw_no_bet_home",
  "ah_home_m025",
  "home_win",
  "ah_home_m05",
];

/** Model-derived fair odds — always tagged oddsSource=model (never as book). */
export function buildModelOdds(
  home: TeamStats,
  away: TeamStats,
  league = "",
): {
  odds: Partial<Record<MarketType, number>>;
  oddsSource: Partial<Record<MarketType, OddsSource>>;
} {
  const odds: Partial<Record<MarketType, number>> = {};
  const oddsSource: Partial<Record<MarketType, OddsSource>> = {};
  for (const m of MARKETS) {
    odds[m] = fairOdds(marketModelProb(m, home, away, { league }));
    oddsSource[m] = "model";
  }
  return { odds, oddsSource };
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

/**
 * Team strength from real form/records when available.
 * Falls back to winRate proxy when form is flat/unknown.
 */
export function buildTeamStatsFromForm(
  name: string,
  opts?: {
    form?: number[];
    winRate?: number;
    restDays?: number;
    injuries?: number;
  },
): TeamStats {
  const form = opts?.form ?? [0.5, 0.5, 0.5, 0.5, 0.5];
  const fa = formAvg(form);
  const winRate = opts?.winRate ?? fa;
  const strength = 0.35 * winRate + 0.65 * fa;
  const gfProxy = 0.65 + strength * 1.5;
  const gaProxy = 1.45 - strength * 0.95;
  return {
    name,
    attack: 0.65 + strength * 1.0,
    defense: 1.35 - strength * 0.75,
    form,
    xgFor: gfProxy,
    xgAgainst: Math.max(0.35, gaProxy),
    shotsPerGame: 9 + strength * 8,
    possession: 44 + strength * 18,
    restDays: opts?.restDays ?? 5,
    injuries: opts?.injuries ?? 1,
    motivation: 0.5 + strength * 0.4,
  };
}

/** @deprecated alias — prefer buildTeamStatsFromForm */
export function proxyTeamStats(
  name: string,
  opts?: {
    form?: number[];
    winRate?: number;
    restDays?: number;
    injuries?: number;
  },
): TeamStats {
  return buildTeamStatsFromForm(name, opts);
}

/** Attach model odds only for markets missing book prices. */
export function fillMissingWithModelOdds(match: MatchCandidate): MatchCandidate {
  const { odds: modelOdds } = buildModelOdds(
    match.home,
    match.away,
    match.league,
  );
  const odds = { ...match.odds };
  const oddsSource = { ...(match.oddsSource ?? {}) };
  for (const m of MARKETS) {
    if (odds[m] == null && modelOdds[m] != null) {
      odds[m] = modelOdds[m];
      oddsSource[m] = "model";
    } else if (odds[m] != null && oddsSource[m] == null) {
      // Legacy rows without source → assume model unless provider is odds-api
      oddsSource[m] = match.provider === "odds-api" ? "book" : "model";
    }
  }
  return { ...match, odds, oddsSource };
}

export function markBookOdds(
  odds: Partial<Record<MarketType, number>>,
): Partial<Record<MarketType, OddsSource>> {
  const src: Partial<Record<MarketType, OddsSource>> = {};
  for (const k of Object.keys(odds) as MarketType[]) {
    if (odds[k] != null) src[k] = "book";
  }
  return src;
}
