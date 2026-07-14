import { fairOdds, marketModelProb } from "@/lib/engine/model";
import type { MarketType, TeamStats } from "@/lib/engine/types";

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

/** Model-derived fair odds (fallback when bookmaker odds missing). */
export function buildModelOdds(
  home: TeamStats,
  away: TeamStats,
): Partial<Record<MarketType, number>> {
  const odds: Partial<Record<MarketType, number>> = {};
  for (const m of MARKETS) {
    odds[m] = fairOdds(marketModelProb(m, home, away), 0.02);
  }
  return odds;
}

/** Lightweight team stats from win-rate / form proxies. */
export function proxyTeamStats(
  name: string,
  opts?: {
    form?: number[];
    winRate?: number;
    restDays?: number;
    injuries?: number;
  },
): TeamStats {
  const winRate = opts?.winRate ?? 0.45;
  const gfProxy = 0.7 + winRate * 1.4;
  const gaProxy = 1.4 - winRate * 0.9;
  return {
    name,
    attack: 0.7 + winRate * 0.9,
    defense: 1.3 - winRate * 0.7,
    form: opts?.form ?? [0.5, 0.5, 0.5, 0.5, 0.5],
    xgFor: gfProxy,
    xgAgainst: Math.max(0.4, gaProxy),
    shotsPerGame: 10 + winRate * 6,
    possession: 45 + winRate * 15,
    restDays: opts?.restDays ?? 5,
    injuries: opts?.injuries ?? 1,
    motivation: 0.55 + winRate * 0.35,
  };
}
