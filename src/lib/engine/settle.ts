import type { MarketType, ScoredPick } from "@/lib/engine/types";

export type SettleResult = "win" | "loss" | "push";

export function settleMarketFromScore(
  market: MarketType,
  homeScore: number,
  awayScore: number,
): SettleResult {
  const total = homeScore + awayScore;
  const homeWin = homeScore > awayScore;
  const draw = homeScore === awayScore;
  const awayWin = homeScore < awayScore;
  const btts = homeScore > 0 && awayScore > 0;

  switch (market) {
    case "home_win":
      return homeWin ? "win" : "loss";
    case "double_chance_1x":
      return homeWin || draw ? "win" : "loss";
    case "draw_no_bet_home":
      if (draw) return "push";
      return homeWin ? "win" : "loss";
    case "under_25":
      return total <= 2 ? "win" : "loss";
    case "under_35":
      return total <= 3 ? "win" : "loss";
    case "btts_no":
      return !btts ? "win" : "loss";
    case "ah_home_m025":
      // Asian -0.25: home win = full win; away = full loss; draw = half-loss.
      // We have no half-loss outcome — treat draw as push (stake returned).
      if (homeWin) return "win";
      if (draw) return "push";
      return "loss";
    case "ah_home_m05":
      return homeWin ? "win" : "loss";
    default:
      return awayWin ? "loss" : "loss";
  }
}

export function settlePick(pick: ScoredPick): SettleResult | null {
  const { match, market } = pick;
  if (match.status !== "finished") return null;
  if (match.homeScore == null || match.awayScore == null) return null;
  return settleMarketFromScore(market, match.homeScore, match.awayScore);
}
