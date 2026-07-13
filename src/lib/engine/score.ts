import {
  ALLOWED_MARKETS,
  MARKET_LABELS,
  isOddsInRange,
  requiresExtremeFavorite,
} from "./markets";
import type {
  LayerScore,
  MarketType,
  MatchCandidate,
  ScoredPick,
  TeamStats,
} from "./types";

const WEIGHTS = {
  football: 0.35,
  stats: 0.25,
  value: 0.2,
  numerology: 0.1,
  stars: 0.1,
} as const;

function clamp(n: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, n));
}

function formAvg(form: number[]): number {
  if (!form.length) return 0.5;
  return form.reduce((a, b) => a + b, 0) / form.length;
}

function poissonPmf(k: number, lambda: number): number {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / fact;
}

function expectedGoals(home: TeamStats, away: TeamStats) {
  const homeAdv = 1.12;
  const lambdaHome = clamp(
    ((home.attack * 1.2) / Math.max(0.4, away.defense)) * homeAdv * 1.15,
    0.2,
    3.5,
  );
  const lambdaAway = clamp(
    ((away.attack * 1.1) / Math.max(0.4, home.defense)) * 1.0,
    0.15,
    3.2,
  );
  return { lambdaHome, lambdaAway };
}

function marketModelProb(
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

  for (let hg = 0; hg <= 8; hg++) {
    for (let ag = 0; ag <= 8; ag++) {
      const p = poissonPmf(hg, lambdaHome) * poissonPmf(ag, lambdaAway);
      if (hg > ag) pHome += p;
      else if (hg === ag) pDraw += p;
      else pAway += p;
      if (hg + ag <= 2) pUnder25 += p;
      if (hg + ag <= 3) pUnder35 += p;
      if (hg === 0 || ag === 0) pBttsNo += p;
    }
  }

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

function digitSum(n: number): number {
  let x = Math.abs(Math.floor(n));
  while (x > 9) {
    x = String(x)
      .split("")
      .reduce((a, d) => a + Number(d), 0);
  }
  return x;
}

function dayNumber(date: Date): number {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return digitSum(y + m + d);
}

function lunarPhase01(date: Date): number {
  // Simple synodic approximation
  const synodic = 29.53058867;
  const knownNew = Date.UTC(2000, 0, 6, 18, 14);
  const days = (date.getTime() - knownNew) / 86400000;
  const phase = ((days % synodic) + synodic) % synodic;
  return phase / synodic;
}

function zodiacIndex(date: Date): number {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const md = m * 100 + d;
  const cuts = [120, 219, 321, 420, 521, 621, 723, 823, 923, 1023, 1122, 1222];
  let i = 0;
  for (let c = 0; c < cuts.length; c++) {
    if (md >= cuts[c]) i = c + 1;
  }
  return i % 12;
}

function footballLayer(
  market: MarketType,
  match: MatchCandidate,
  modelProb: number,
): LayerScore {
  const homeForm = formAvg(match.home.form);
  const awayForm = formAvg(match.away.form);
  const formGap = (homeForm - awayForm + 1) / 2;
  const base = modelProb * 100;
  const formBoost = formGap * 12;
  const extreme =
    requiresExtremeFavorite(market) && modelProb < 0.72 ? -18 : 0;
  const score = clamp(base * 0.85 + formBoost + extreme + 8);
  return {
    key: "football",
    label: "Probabilidad futbolística",
    weight: WEIGHTS.football,
    score,
    note: `p(modelo)=${(modelProb * 100).toFixed(1)}% · forma local ${homeForm.toFixed(2)}`,
  };
}

function statsLayer(match: MatchCandidate, market: MarketType): LayerScore {
  const { home, away } = match;
  const xgEdge = home.xgFor - away.xgAgainst * 0.5 - (away.xgFor - home.xgAgainst * 0.5);
  const rest = clamp(50 + (home.restDays - away.restDays) * 6, 20, 90);
  const health = clamp(80 - home.injuries * 8 + away.injuries * 4, 20, 95);
  const motiva = clamp(home.motivation * 100, 30, 95);
  const possession = home.possession;
  let marketFit = 70;
  if (market.startsWith("under")) {
    marketFit = clamp(100 - (home.xgFor + away.xgFor) * 18, 35, 95);
  }
  if (market === "btts_no") {
    marketFit = clamp(95 - (home.xgFor + away.xgFor) * 16, 30, 95);
  }
  const score = clamp(
    0.3 * clamp(55 + xgEdge * 20) +
      0.2 * rest +
      0.2 * health +
      0.15 * motiva +
      0.15 * marketFit,
  );
  return {
    key: "stats",
    label: "Estudio y estadísticas",
    weight: WEIGHTS.stats,
    score,
    note: `xG edge ${xgEdge.toFixed(2)} · descanso ${home.restDays}d · pos ${possession.toFixed(0)}%`,
  };
}

function valueLayer(odds: number, modelProb: number): LayerScore {
  const implied = 1 / odds;
  const edge = modelProb - implied;
  // Fractional Kelly as filter signal only
  const b = odds - 1;
  const kelly = b > 0 ? (b * modelProb - (1 - modelProb)) / b : -1;
  let score = clamp(50 + edge * 400 + kelly * 40);
  if (edge < 0.01) score = Math.min(score, 55);
  if (edge < 0) score = Math.min(score, 40);
  if (odds < 1.03 || odds > 1.35) score = Math.min(score, 45);
  // "too good to be true" soft reject for grind philosophy
  if (odds < 1.04 && edge > 0.08) score = Math.min(score, 60);
  return {
    key: "value",
    label: "Matemática de valor",
    weight: WEIGHTS.value,
    score,
    note: `edge ${(edge * 100).toFixed(1)}pp · Kelly frac ${kelly.toFixed(3)}`,
  };
}

function numerologyLayer(
  date: Date,
  match: MatchCandidate,
  odds: number,
): LayerScore {
  const day = dayNumber(date);
  const affinity1111 = day === 2 || day === 1 || day === 8 ? 12 : 0;
  const matchdayAff =
    digitSum(match.matchday) === digitSum(108) ||
    digitSum(match.matchday) === 1
      ? 8
      : 0;
  const oddsDigits = digitSum(Math.round(odds * 100));
  const elevenPull = oddsDigits === 2 || oddsDigits === 1 ? 6 : 0;
  const score = clamp(62 + affinity1111 + matchdayAff + elevenPull);
  return {
    key: "numerology",
    label: "Numerología del día",
    weight: WEIGHTS.numerology,
    score,
    note: `número del día ${day} · jornada ${match.matchday} (capa simbólica)`,
  };
}

function starsLayer(date: Date): LayerScore {
  const phase = lunarPhase01(date);
  // Prefer waxing gibbous / full-ish for "clarity" narrative — soft only
  const lunar = 1 - Math.abs(phase - 0.5) * 1.4;
  const z = zodiacIndex(date);
  const earthSigns = [1, 4, 7, 10]; // Taurus-ish indices in our scheme
  const earthBoost = earthSigns.includes(z) ? 8 : 0;
  const score = clamp(58 + lunar * 25 + earthBoost);
  return {
    key: "stars",
    label: "Estrellas / atmósfera",
    weight: WEIGHTS.stars,
    score,
    note: `fase lunar ${(phase * 100).toFixed(0)}% · signo #${z + 1} (capa lúdica)`,
  };
}

export function scoreMarket(
  match: MatchCandidate,
  market: MarketType,
  hourKey: string,
  now = new Date(),
): ScoredPick | null {
  const odds = match.odds[market];
  if (odds == null || !isOddsInRange(odds)) return null;

  const modelProb = marketModelProb(market, match.home, match.away);

  if (requiresExtremeFavorite(market) && modelProb < 0.68) return null;
  if (market === "ah_home_m05" && modelProb < 0.74) return null;

  const layers: LayerScore[] = [
    footballLayer(market, match, modelProb),
    statsLayer(match, market),
    valueLayer(odds, modelProb),
    numerologyLayer(now, match, odds),
    starsLayer(now),
  ];

  const totalScore = clamp(
    layers.reduce((sum, l) => sum + l.score * l.weight, 0),
  );

  const implied = 1 / odds;
  const edge = modelProb - implied;

  return {
    match,
    market,
    marketLabel: MARKET_LABELS[market],
    odds,
    modelProb,
    edge,
    totalScore,
    layers,
    hourKey,
  };
}

export function pickBestForHour(
  matches: MatchCandidate[],
  hourKey: string,
  threshold: number,
  now = new Date(),
): ScoredPick | null {
  const scored: ScoredPick[] = [];
  for (const match of matches) {
    for (const market of ALLOWED_MARKETS) {
      const s = scoreMarket(match, market, hourKey, now);
      if (s && s.totalScore >= threshold && s.edge >= 0.005) {
        scored.push(s);
      }
    }
  }
  scored.sort((a, b) => b.totalScore - a.totalScore || b.edge - a.edge);
  return scored[0] ?? null;
}
