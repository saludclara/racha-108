import {
  ALLOWED_MARKETS,
  MARKET_LABELS,
  isOddsInRange,
  requiresExtremeFavorite,
} from "./markets";
import {
  SCORE_WEIGHTS,
  computeNumerologyScore,
  computeStarsScore,
} from "./numerology";
import { marketModelProb } from "./model";
import type {
  LayerScore,
  MarketType,
  MatchCandidate,
  ScoredPick,
} from "./types";

const WEIGHTS = SCORE_WEIGHTS;

export const MIN_MODEL_PROB = 0.78;
export const MIN_EDGE = -0.01;

function clamp(n: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, n));
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
  return s / w;
}

function numerologyLayer(
  date: Date,
  hourKey: string,
  match: MatchCandidate,
  market: MarketType,
  odds: number,
): LayerScore {
  const { score, note } = computeNumerologyScore(
    date,
    hourKey,
    match.matchday,
    market,
    odds,
  );
  return {
    key: "numerology",
    label: "Numerología del día",
    weight: WEIGHTS.numerology,
    score,
    note,
  };
}

function starsLayer(date: Date): LayerScore {
  const { score, note } = computeStarsScore(date);
  return {
    key: "stars",
    label: "Estrellas / atmósfera",
    weight: WEIGHTS.stars,
    score,
    note,
  };
}

function footballLayer(
  market: MarketType,
  match: MatchCandidate,
  modelProb: number,
): LayerScore {
  const homeForm = formAvg(match.home.form);
  const awayForm = formAvg(match.away.form);
  const formGap = homeForm - awayForm;
  const extreme =
    requiresExtremeFavorite(market) && modelProb < 0.78 ? -22 : 0;
  const score = clamp(modelProb * 100 * 0.92 + clamp(formGap * 18, -12, 14) + extreme);
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
    marketFit = clamp(108 - (home.xgFor + away.xgFor) * 22, 40, 98);
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
  if (edge < 0) score = Math.min(score, 42);
  if (odds > 1.22) score = Math.min(score, 58);
  return {
    key: "value",
    label: "Matemática de valor",
    weight: WEIGHTS.value,
    score,
    note: `edge ${(edge * 100).toFixed(1)}pp · Kelly ${kelly.toFixed(3)}`,
  };
}

function buildScoredPick(
  match: MatchCandidate,
  market: MarketType,
  hourKey: string,
  now: Date,
  opts: { strict: boolean },
): ScoredPick | null {
  const odds = match.odds[market];
  if (odds == null || !isOddsInRange(odds)) return null;

  const modelProb = marketModelProb(market, match.home, match.away);

  if (opts.strict) {
    if (modelProb < MIN_MODEL_PROB) return null;
    if (requiresExtremeFavorite(market) && modelProb < 0.8) return null;
    if (market === "ah_home_m05" && modelProb < 0.86) return null;
    if (market === "home_win" && modelProb < 0.78) return null;
  } else if (modelProb < 0.7) {
    return null;
  }

  const layers: LayerScore[] = [
    footballLayer(market, match, modelProb),
    statsLayer(match, market),
    valueLayer(odds, modelProb),
    numerologyLayer(now, hourKey, match, market, odds),
    starsLayer(now),
  ];

  const totalScore = clamp(
    layers.reduce((sum, l) => sum + l.score * l.weight, 0),
  );

  const implied = 1 / odds;
  const edge = modelProb - implied;
  if (opts.strict && edge < MIN_EDGE) return null;

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

function rankPicks(list: ScoredPick[]): ScoredPick[] {
  return [...list].sort((a, b) => {
    if (b.modelProb !== a.modelProb) return b.modelProb - a.modelProb;
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return (marketPriority[b.market] ?? 0) - (marketPriority[a.market] ?? 0);
  });
}

/**
 * Best real-match grind pick. Returns null if no real candidates qualify.
 * Never invents fixtures.
 */
export function pickBestForHour(
  matches: MatchCandidate[],
  hourKey: string,
  threshold: number,
  now = new Date(),
): ScoredPick | null {
  if (!matches.length) return null;

  const primary: ScoredPick[] = [];
  const soft: ScoredPick[] = [];

  for (const match of matches) {
    for (const market of ALLOWED_MARKETS) {
      const strict = buildScoredPick(match, market, hourKey, now, {
        strict: true,
      });
      if (strict) {
        soft.push(strict);
        if (strict.totalScore >= threshold || strict.modelProb >= 0.88) {
          primary.push(strict);
        }
        continue;
      }
      const loose = buildScoredPick(match, market, hourKey, now, {
        strict: false,
      });
      if (loose) soft.push(loose);
    }
  }

  if (primary.length) return rankPicks(primary)[0];
  if (soft.length) return rankPicks(soft)[0];
  return null;
}
