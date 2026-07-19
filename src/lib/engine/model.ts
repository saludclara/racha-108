import type { MarketType, MatchCandidate, TeamStats } from "./types";

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
  rho: number,
): number {
  if (hg === 0 && ag === 0) return 1 - lambdaHome * lambdaAway * rho;
  if (hg === 0 && ag === 1) return 1 + lambdaHome * rho;
  if (hg === 1 && ag === 0) return 1 + lambdaAway * rho;
  if (hg === 1 && ag === 1) return 1 - rho;
  return 1;
}

/** League-tuned home advantage + low-score correlation. */
function leagueParams(league: string): { homeAdv: number; rho: number } {
  const L = league.toLowerCase();
  if (/mls|usa|mexico|liga mx|mexic/.test(L)) return { homeAdv: 1.12, rho: -0.1 };
  if (/premier|epl|england/.test(L)) return { homeAdv: 1.14, rho: -0.09 };
  if (/laliga|la liga|spain|serie a|bundesliga|ligue/.test(L))
    return { homeAdv: 1.13, rho: -0.08 };
  if (/a-league|aleague|australia/.test(L)) return { homeAdv: 1.11, rho: -0.1 };
  if (/libertadores|sudamericana|champions|europa/.test(L))
    return { homeAdv: 1.08, rho: -0.07 };
  return { homeAdv: 1.1, rho: -0.08 };
}

function expectedGoals(
  home: TeamStats,
  away: TeamStats,
  league = "",
  live?: { homeScore: number; awayScore: number; minute: number },
) {
  const { homeAdv, rho } = leagueParams(league);
  const attackHome = Math.max(0.35, home.attack);
  const defenseAway = Math.max(0.45, away.defense);
  const attackAway = Math.max(0.3, away.attack);
  const defenseHome = Math.max(0.45, home.defense);

  let lambdaHome = clamp(
    (attackHome / defenseAway) * homeAdv * (0.55 + home.xgFor * 0.28),
    0.25,
    3.2,
  );
  let lambdaAway = clamp(
    (attackAway / defenseHome) * (0.5 + away.xgFor * 0.28),
    0.2,
    2.8,
  );

  // Live: scale remaining expected goals by time left
  if (live && Number.isFinite(live.minute) && live.minute > 0) {
    const minute = Math.min(95, Math.max(1, live.minute));
    const remain = Math.max(0.08, (90 - minute) / 90);
    lambdaHome *= remain;
    lambdaAway *= remain;
  }

  return { lambdaHome, lambdaAway, rho, homeAdv };
}

export function marketModelProb(
  market: MarketType,
  home: TeamStats,
  away: TeamStats,
  ctx?: {
    league?: string;
    status?: MatchCandidate["status"];
    homeScore?: number;
    awayScore?: number;
    minute?: number;
  },
): number {
  const live =
    ctx?.status === "inplay" &&
    ctx.homeScore != null &&
    ctx.awayScore != null &&
    ctx.minute != null &&
    ctx.minute > 0
      ? {
          homeScore: ctx.homeScore,
          awayScore: ctx.awayScore,
          minute: ctx.minute,
        }
      : undefined;

  const { lambdaHome, lambdaAway, rho } = expectedGoals(
    home,
    away,
    ctx?.league ?? "",
    live,
  );

  const baseHome = live?.homeScore ?? 0;
  const baseAway = live?.awayScore ?? 0;

  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  let pUnder25 = 0;
  let pUnder35 = 0;
  let pBttsNo = 0;
  let norm = 0;

  for (let hg = 0; hg <= 8; hg++) {
    for (let ag = 0; ag <= 8; ag++) {
      const tau = dixonColesTau(hg, ag, lambdaHome, lambdaAway, rho);
      const p =
        tau * poissonPmf(hg, lambdaHome) * poissonPmf(ag, lambdaAway);
      norm += p;
      const fh = baseHome + hg;
      const fa = baseAway + ag;
      if (fh > fa) pHome += p;
      else if (fh === fa) pDraw += p;
      else pAway += p;
      if (fh + fa <= 2) pUnder25 += p;
      if (fh + fa <= 3) pUnder35 += p;
      if (fh === 0 || fa === 0) pBttsNo += p;
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

/**
 * Model fill prices (not book). Keep coherent with Dixon–Coles favorites —
 * do not stretch to the book value band (that invents fake edge).
 */
export function fairOdds(modelProb: number, soft = 0.025): number {
  const implied = Math.min(0.93, Math.max(0.74, modelProb - soft));
  const odds = 1 / implied;
  return Math.round(Math.max(1.08, Math.min(1.35, odds)) * 100) / 100;
}
