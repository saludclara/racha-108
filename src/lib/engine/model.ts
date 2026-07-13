import type { MarketType, TeamStats } from "./types";

function clamp(n: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, n));
}

function factorial(k: number): number {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return f;
}

function poissonPmf(k: number, lambda: number): number {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

function dixonColesTau(
  hg: number,
  ag: number,
  lambdaHome: number,
  lambdaAway: number,
  rho = -0.08,
): number {
  if (hg === 0 && ag === 0) return 1 - lambdaHome * lambdaAway * rho;
  if (hg === 0 && ag === 1) return 1 + lambdaHome * rho;
  if (hg === 1 && ag === 0) return 1 + lambdaAway * rho;
  if (hg === 1 && ag === 1) return 1 - rho;
  return 1;
}

export function expectedGoals(home: TeamStats, away: TeamStats) {
  const homeAdv = 1.1;
  const attackHome = Math.max(0.35, home.attack);
  const defenseAway = Math.max(0.45, away.defense);
  const attackAway = Math.max(0.3, away.attack);
  const defenseHome = Math.max(0.45, home.defense);

  const lambdaHome = clamp(
    (attackHome / defenseAway) * homeAdv * (0.55 + home.xgFor * 0.28),
    0.25,
    3.2,
  );
  const lambdaAway = clamp(
    (attackAway / defenseHome) * (0.5 + away.xgFor * 0.28),
    0.2,
    2.8,
  );
  return { lambdaHome, lambdaAway };
}

export function marketModelProb(
  market: MarketType,
  home: TeamStats,
  away: TeamStats,
): number {
  const { lambdaHome, lambdaAway } = expectedGoals(home, away);
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  let pUnder25 = 0;
  let pUnder35 = 0;
  let pBttsNo = 0;
  let norm = 0;

  for (let hg = 0; hg <= 8; hg++) {
    for (let ag = 0; ag <= 8; ag++) {
      const tau = dixonColesTau(hg, ag, lambdaHome, lambdaAway);
      const p =
        tau * poissonPmf(hg, lambdaHome) * poissonPmf(ag, lambdaAway);
      norm += p;
      if (hg > ag) pHome += p;
      else if (hg === ag) pDraw += p;
      else pAway += p;
      if (hg + ag <= 2) pUnder25 += p;
      if (hg + ag <= 3) pUnder35 += p;
      if (hg === 0 || ag === 0) pBttsNo += p;
    }
  }

  pHome /= norm;
  pDraw /= norm;
  pAway /= norm;
  pUnder25 /= norm;
  pUnder35 /= norm;
  pBttsNo /= norm;

  switch (market) {
    case "home_win":
      return pHome;
    case "double_chance_1x":
      return pHome + pDraw;
    case "draw_no_bet_home":
      return pHome / Math.max(0.01, pHome + pAway);
    case "under_25":
      return pUnder25;
    case "under_35":
      return pUnder35;
    case "btts_no":
      return pBttsNo;
    case "ah_home_m025":
      return pHome + 0.5 * pDraw;
    case "ah_home_m05":
      return pHome;
    default:
      return 0.5;
  }
}

/** Odds slightly softer than true model prob → positive edge */
export function fairOdds(modelProb: number, soft = 0.025): number {
  const implied = Math.min(0.96, Math.max(0.78, modelProb - soft));
  const odds = 1 / implied;
  return Math.round(Math.max(1.05, Math.min(1.22, odds)) * 100) / 100;
}
