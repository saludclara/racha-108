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

/** Core accuracy weights — symbolic layers stay soft */
const WEIGHTS = {
  football: 0.4,
  stats: 0.28,
  value: 0.22,
  numerology: 0.05,
  stars: 0.05,
} as const;

/** Hard gate: only bet when model confidence is very high */
export const MIN_MODEL_PROB = 0.86;
export const MIN_EDGE = 0.0;

function clamp(n: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, n));
}

function formAvg(form: number[]): number {
  if (!form.length) return 0.5;
  // Recent form weighted more heavily
  let w = 0;
  let s = 0;
  form.forEach((v, i) => {
    const weight = i + 1;
    s += v * weight;
    w += weight;
  });
  return s / w;
}

function factorial(k: number): number {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return f;
}

function poissonPmf(k: number, lambda: number): number {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

/** Dixon–Coles low-score correlation adjustment */
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

function expectedGoals(home: TeamStats, away: TeamStats) {
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

  // Normalize after tau
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
  return digitSum(date.getFullYear() + date.getMonth() + 1 + date.getDate());
}

function lunarPhase01(date: Date): number {
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
  const formGap = homeForm - awayForm;
  const base = modelProb * 100;
  const formBoost = clamp(formGap * 18, -12, 14);
  const extreme =
    requiresExtremeFavorite(market) && modelProb < 0.78 ? -22 : 0;
  const score = clamp(base * 0.92 + formBoost + extreme);
  return {
    key: "football",
    label: "Probabilidad futbolística",
    weight: WEIGHTS.football,
    score,
    note: `Dixon–Coles p=${(modelProb * 100).toFixed(1)}% · forma Δ ${formGap.toFixed(2)}`,
  };
}

function statsLayer(match: MatchCandidate, market: MarketType): LayerScore {
  const { home, away } = match;
  const xgDiff = home.xgFor - away.xgFor;
  const xgaDiff = away.xgAgainst - home.xgAgainst;
  const rest = clamp(52 + (home.restDays - away.restDays) * 7, 25, 92);
  const health = clamp(82 - home.injuries * 9 + away.injuries * 5, 25, 96);
  const motiva = clamp(home.motivation * 100, 35, 96);
  let marketFit = 68;
  if (market === "under_35" || market === "under_25") {
    const totalXg = home.xgFor + away.xgFor;
    marketFit = clamp(108 - totalXg * 22, 40, 98);
  }
  if (market === "btts_no") {
    marketFit = clamp(100 - (home.xgFor + away.xgFor) * 18, 35, 96);
  }
  if (market === "double_chance_1x" || market === "draw_no_bet_home") {
    marketFit = clamp(60 + xgDiff * 18 + xgaDiff * 10, 40, 96);
  }
  const score = clamp(
    0.28 * clamp(55 + xgDiff * 22 + xgaDiff * 12) +
      0.22 * rest +
      0.2 * health +
      0.15 * motiva +
      0.15 * marketFit,
  );
  return {
    key: "stats",
    label: "Estudio y estadísticas",
    weight: WEIGHTS.stats,
    score,
    note: `xG Δ ${xgDiff.toFixed(2)} · descanso ${home.restDays}d · lesiones ${home.injuries}`,
  };
}

function valueLayer(odds: number, modelProb: number): LayerScore {
  const implied = 1 / odds;
  const edge = modelProb - implied;
  const b = odds - 1;
  const kelly = b > 0 ? (b * modelProb - (1 - modelProb)) / b : -1;
  let score = clamp(48 + edge * 520 + kelly * 55);
  if (edge < 0) score = Math.min(score, 35);
  if (edge >= 0 && edge < 0.015) score = Math.min(score, 62);
  if (odds > 1.22) score = Math.min(score, 58);
  if (odds < 1.04 && edge > 0.1) score = Math.min(score, 55);
  return {
    key: "value",
    label: "Matemática de valor",
    weight: WEIGHTS.value,
    score,
    note: `edge ${(edge * 100).toFixed(1)}pp · Kelly ${kelly.toFixed(3)}`,
  };
}

function numerologyLayer(
  date: Date,
  match: MatchCandidate,
  odds: number,
): LayerScore {
  const day = dayNumber(date);
  const affinity = day === 1 || day === 2 || day === 8 ? 10 : 0;
  const matchdayAff = digitSum(match.matchday) === 9 ? 6 : 0;
  const oddsDigits = digitSum(Math.round(odds * 100));
  const elevenPull = oddsDigits === 2 || oddsDigits === 1 ? 4 : 0;
  return {
    key: "numerology",
    label: "Numerología del día",
    weight: WEIGHTS.numerology,
    score: clamp(60 + affinity + matchdayAff + elevenPull),
    note: `día ${day} · jornada ${match.matchday} (simbólica)`,
  };
}

function starsLayer(date: Date): LayerScore {
  const phase = lunarPhase01(date);
  const lunar = 1 - Math.abs(phase - 0.5) * 1.2;
  const z = zodiacIndex(date);
  const earthBoost = [1, 4, 7, 10].includes(z) ? 6 : 0;
  return {
    key: "stars",
    label: "Estrellas / atmósfera",
    weight: WEIGHTS.stars,
    score: clamp(58 + lunar * 22 + earthBoost),
    note: `luna ${(phase * 100).toFixed(0)}% (lúdica)`,
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

  // Accuracy hard gates
  if (modelProb < MIN_MODEL_PROB) return null;
  if (requiresExtremeFavorite(market) && modelProb < 0.8) return null;
  if (market === "ah_home_m05" && modelProb < 0.86) return null;
  if (market === "home_win" && modelProb < 0.78) return null;

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
  if (edge < MIN_EDGE) return null;

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

/**
 * Rank by true confidence first (modelProb), then composite score.
 * Prefer ultra-safe grind markets when confidence ties.
 */
export function pickBestForHour(
  matches: MatchCandidate[],
  hourKey: string,
  threshold: number,
  now = new Date(),
): ScoredPick | null {
  const scored: ScoredPick[] = [];
  const fallback: ScoredPick[] = [];

  for (const match of matches) {
    for (const market of ALLOWED_MARKETS) {
      const s = scoreMarket(match, market, hourKey, now);
      if (!s) continue;
      fallback.push(s);
      if (s.totalScore >= threshold || s.modelProb >= 0.9) {
        scored.push(s);
      }
    }
  }

  const marketPriority: Partial<Record<MarketType, number>> = {
    under_35: 5,
    double_chance_1x: 4,
    btts_no: 3,
    draw_no_bet_home: 3,
    under_25: 2,
    ah_home_m025: 2,
    home_win: 1,
    ah_home_m05: 1,
  };

  const rank = (list: ScoredPick[]) =>
    list.sort((a, b) => {
      if (b.modelProb !== a.modelProb) return b.modelProb - a.modelProb;
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      return (marketPriority[b.market] ?? 0) - (marketPriority[a.market] ?? 0);
    });

  if (scored.length) return rank(scored)[0];

  // Fallback: still auto-bet the single safest market of the hour
  const safe = rank(fallback).filter((s) => s.modelProb >= 0.88);
  return safe[0] ?? null;
}
