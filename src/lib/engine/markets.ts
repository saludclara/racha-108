import { MAX_ODDS, MIN_ODDS, type MarketType } from "./types";

export const MARKET_LABELS: Record<MarketType, string> = {
  home_win: "Victoria local",
  double_chance_1x: "Doble oportunidad 1X",
  draw_no_bet_home: "Draw No Bet (local)",
  under_25: "Under 2.5",
  under_35: "Under 3.5",
  btts_no: "Ambos marcan: No",
  ah_home_m025: "Hándicap asiático local -0.25",
  ah_home_m05: "Hándicap asiático local -0.5",
};

/** Ultra-conservative grind markets only */
export const ALLOWED_MARKETS: MarketType[] = [
  "home_win",
  "double_chance_1x",
  "draw_no_bet_home",
  "under_25",
  "under_35",
  "btts_no",
  "ah_home_m025",
  "ah_home_m05",
];

export function isOddsInRange(odds: number): boolean {
  return odds >= MIN_ODDS && odds <= MAX_ODDS;
}

export function requiresExtremeFavorite(market: MarketType): boolean {
  return market === "home_win" || market === "ah_home_m05";
}
