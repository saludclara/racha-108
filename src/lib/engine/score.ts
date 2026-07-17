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
import { softBlacklists, type SoftBlacklist } from "./metrics";
import type {
  HistoryEntry,
  LayerScore,
  MarketType,
  MatchCandidate,
  OddsSource,
  ScoredPick,
} from "./types";

const WEIGHTS = SCORE_WEIGHTS;

/** Hard filters for quality / shadow EV. */
export const MIN_MODEL_PROB = 0.78;
export const MIN_EDGE_BOOK = 0;
/** Without book odds — rank by modelProb only (no fake edge). */
export const MIN_MODEL_PROB_SOFT = 0.78;

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

function oddsSourceFor(
  match: MatchCandidate,
  market: MarketType,
): OddsSource {
  return match.oddsSource?.[market] ?? "model";
}

/** Score without lore — used for threshold / rank tie-breaks. */
export function grindScore(layers: LayerScore[]): number {
  let sum = 0;
  let w = 0;
  for (const l of layers) {
    if (l.key === "numerology" || l.key === "stars") continue;
    sum += l.score * l.weight;
    w += l.weight;
  }
  if (w <= 0) return 0;
  return clamp(sum / w);
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
  const score = clamp(
    modelProb * 100 * 0.92 + clamp(formGap * 18, -12, 14) + extreme,
  );
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

/** Value layer only counts when odds are from a bookmaker. */
function valueLayer(
  odds: number,
  modelProb: number,
  source: OddsSource,
): LayerScore {
  if (source !== "book") {
    return {
      key: "value",
      label: "Matemática de valor",
      weight: WEIGHTS.value,
      score: 50,
      note: "Sin cuotas book · edge no aplica (no se finge con modelo)",
    };
  }
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
    note: `book edge ${(edge * 100).toFixed(1)}pp · Kelly ${kelly.toFixed(3)}`,
  };
}

function modelCtx(match: MatchCandidate) {
  return {
    league: match.league,
    status: match.status,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    minute: match.minute,
  };
}

export type QualityGates = {
  minModelProb: number;
  minModelProbSoft: number;
  minEdgeBook: number;
};

/** Tilt raises EV gates (not only the UI score threshold). */
export function qualityGatesFor(tiltActive: boolean): QualityGates {
  if (!tiltActive) {
    return {
      minModelProb: MIN_MODEL_PROB,
      minModelProbSoft: MIN_MODEL_PROB_SOFT,
      minEdgeBook: MIN_EDGE_BOOK,
    };
  }
  return {
    minModelProb: Math.min(0.9, MIN_MODEL_PROB + 0.04),
    minModelProbSoft: Math.min(0.92, MIN_MODEL_PROB_SOFT + 0.05),
    minEdgeBook: 0.015,
  };
}

export type QualityGate = {
  ok: boolean;
  reasons: string[];
};

/** Whether EV/quality filters would accept this candidate. */
export function evaluateQuality(
  pick: ScoredPick,
  gates: QualityGates = qualityGatesFor(false),
): QualityGate {
  const reasons: string[] = [];
  if (pick.oddsSource === "book") {
    if (pick.edge < gates.minEdgeBook) {
      reasons.push(
        `edge ${(pick.edge * 100).toFixed(1)}pp < ${(gates.minEdgeBook * 100).toFixed(1)}pp`,
      );
    }
    if (pick.modelProb < gates.minModelProb) {
      reasons.push(
        `p_model ${(pick.modelProb * 100).toFixed(1)}% < ${(gates.minModelProb * 100).toFixed(0)}%`,
      );
    }
  } else if (pick.modelProb < gates.minModelProbSoft) {
    reasons.push(
      `sin book · p_model ${(pick.modelProb * 100).toFixed(1)}% < ${(gates.minModelProbSoft * 100).toFixed(0)}%`,
    );
  }
  if (requiresExtremeFavorite(pick.market) && pick.modelProb < 0.8) {
    reasons.push("mercado favorito extremo necesita p≥80%");
  }
  if (pick.market === "ah_home_m05" && pick.modelProb < 0.86) {
    reasons.push("AH -0.5 necesita p≥86%");
  }
  if (pick.market === "home_win" && pick.modelProb < 0.78) {
    reasons.push("1X2 home necesita p≥78%");
  }
  return { ok: reasons.length === 0, reasons };
}

function buildScoredPick(
  match: MatchCandidate,
  market: MarketType,
  hourKey: string,
  now: Date,
  opts: { strict: boolean; force?: boolean; gates: QualityGates },
): ScoredPick | null {
  const odds = match.odds[market];
  if (odds == null || !isOddsInRange(odds)) return null;

  const source = oddsSourceFor(match, market);
  const modelProb = marketModelProb(
    market,
    match.home,
    match.away,
    modelCtx(match),
  );

  const implied = 1 / odds;
  const edge = modelProb - implied;
  const { gates } = opts;

  if (!opts.force) {
    if (opts.strict) {
      if (source === "book") {
        if (modelProb < gates.minModelProb) return null;
        if (edge < gates.minEdgeBook) return null;
      } else if (modelProb < gates.minModelProbSoft) {
        return null;
      }
      if (requiresExtremeFavorite(market) && modelProb < 0.8) return null;
      if (market === "ah_home_m05" && modelProb < 0.86) return null;
      if (market === "home_win" && modelProb < 0.78) return null;
    } else if (modelProb < 0.7) {
      return null;
    }
  }

  const layers: LayerScore[] = [
    footballLayer(market, match, modelProb),
    statsLayer(match, market),
    valueLayer(odds, modelProb, source),
    numerologyLayer(now, hourKey, match, market, odds),
    starsLayer(now),
  ];

  const totalScore = clamp(
    layers.reduce((sum, l) => sum + l.score * l.weight, 0),
  );

  const pick: ScoredPick = {
    match,
    market,
    marketLabel: MARKET_LABELS[market],
    odds,
    modelProb,
    edge,
    bookOdds: source === "book" ? odds : undefined,
    oddsSource: source,
    totalScore,
    layers,
    hourKey,
  };

  const quality = evaluateQuality(pick, gates);
  pick.shadowWouldSkip = !quality.ok;
  pick.shadowNote = quality.ok
    ? "EV/quality OK"
    : `Shadow SKIP: ${quality.reasons.join("; ")}`;

  return pick;
}

/** Prefer grind DC/under; AH last (settle noisier). */
const marketPriority: Partial<Record<MarketType, number>> = {
  under_35: 5,
  double_chance_1x: 5,
  draw_no_bet_home: 4,
  under_25: 4,
  btts_no: 3,
  home_win: 2,
  ah_home_m025: 1,
  ah_home_m05: 0,
};

/** Primary rank: book edge → modelProb → grind score (no lore) → market. */
function rankPicks(list: ScoredPick[]): ScoredPick[] {
  return [...list].sort((a, b) => {
    const aBook = a.oddsSource === "book" ? 1 : 0;
    const bBook = b.oddsSource === "book" ? 1 : 0;
    if (bBook !== aBook) return bBook - aBook;
    if (a.oddsSource === "book" && b.oddsSource === "book") {
      if (b.edge !== a.edge) return b.edge - a.edge;
    }
    if (b.modelProb !== a.modelProb) return b.modelProb - a.modelProb;
    const ag = grindScore(a.layers);
    const bg = grindScore(b.layers);
    if (bg !== ag) return bg - ag;
    return (marketPriority[b.market] ?? 0) - (marketPriority[a.market] ?? 0);
  });
}

function filterBlacklisted(
  matches: MatchCandidate[],
  bl: SoftBlacklist | null,
): MatchCandidate[] {
  if (!bl) return matches;
  return matches.filter((m) => {
    if (m.league && bl.leagues.has(m.league)) return false;
    if (m.provider && bl.providers.has(m.provider)) return false;
    return true;
  });
}

function collectCandidates(
  matches: MatchCandidate[],
  hourKey: string,
  now: Date,
  gates: QualityGates,
  guarantee: boolean,
): { quality: ScoredPick[]; soft: ScoredPick[]; forced: ScoredPick[] } {
  const quality: ScoredPick[] = [];
  const soft: ScoredPick[] = [];
  const forced: ScoredPick[] = [];

  for (const match of matches) {
    for (const market of ALLOWED_MARKETS) {
      const strict = buildScoredPick(match, market, hourKey, now, {
        strict: true,
        gates,
      });
      if (strict) {
        quality.push(strict);
        soft.push(strict);
        continue;
      }
      const loose = buildScoredPick(match, market, hourKey, now, {
        strict: false,
        gates,
      });
      if (loose) {
        soft.push(loose);
        continue;
      }
      if (guarantee) {
        const g = buildScoredPick(match, market, hourKey, now, {
          strict: false,
          force: true,
          gates,
        });
        if (g) forced.push(g);
      }
    }
  }
  return { quality, soft, forced };
}

function selectFromBuckets(
  quality: ScoredPick[],
  soft: ScoredPick[],
  forced: ScoredPick[],
  threshold: number,
  guarantee: boolean,
): ScoredPick | null {
  const primary = quality.filter((p) => {
    const g = grindScore(p.layers);
    return g >= threshold || p.modelProb >= 0.88 || p.edge >= 0.02;
  });

  if (primary.length) return rankPicks(primary)[0];
  if (quality.length) return rankPicks(quality)[0];
  if (!guarantee) return null;
  if (soft.length) return rankPicks(soft)[0];
  if (forced.length) return rankPicks(forced)[0];
  return null;
}

export type PickBestOptions = {
  /**
   * Shadow week default: true — keep product picks, log EV decision.
   * Set false (or MOTOR_GUARANTEE=0) to enable quality SKIP for real.
   */
  guarantee?: boolean;
  tiltActive?: boolean;
  history?: HistoryEntry[];
};

function resolveGuarantee(opts: PickBestOptions): boolean {
  if (typeof opts.guarantee === "boolean") return opts.guarantee;
  // Env escape hatch: MOTOR_GUARANTEE=0 ends shadow week
  if (process.env.MOTOR_GUARANTEE === "0") return false;
  return true;
}

/**
 * Best settleable-window grind pick.
 * Shadow (default): guarantee on + shadowWouldSkip / shadowNote from pure EV.
 */
export function pickBestForHour(
  matches: MatchCandidate[],
  hourKey: string,
  threshold: number,
  now = new Date(),
  opts: PickBestOptions = {},
): ScoredPick | null {
  if (!matches.length) return null;

  const guarantee = resolveGuarantee(opts);
  const gates = qualityGatesFor(Boolean(opts.tiltActive));
  const bl =
    opts.history && opts.history.length
      ? softBlacklists(opts.history)
      : null;
  const filtered = filterBlacklisted(matches, bl);
  // Soft: if blacklist wipes the board, keep the settleable pool
  const pool = filtered.length ? filtered : matches;
  if (!pool.length) return null;

  // Pure EV candidate (what we would do with guarantee off)
  const evBuckets = collectCandidates(pool, hourKey, now, gates, false);
  const evPick = selectFromBuckets(
    evBuckets.quality,
    evBuckets.soft,
    evBuckets.forced,
    threshold,
    false,
  );

  if (!guarantee) {
    if (!evPick) return null;
    evPick.shadowWouldSkip = false;
    evPick.shadowNote = "EV mode · pick taken";
    return evPick;
  }

  // Product pick may fall back to soft/forced
  const prodBuckets = collectCandidates(pool, hourKey, now, gates, true);
  const pick = selectFromBuckets(
    prodBuckets.quality,
    prodBuckets.soft,
    prodBuckets.forced,
    threshold,
    true,
  );
  if (!pick) return null;

  if (!evPick) {
    pick.shadowWouldSkip = true;
    pick.shadowNote =
      "Shadow: EV would SKIP this cycle (HotStack would stay intact)";
  } else if (
    evPick.match.id !== pick.match.id ||
    evPick.market !== pick.market
  ) {
    pick.shadowWouldSkip = false;
    pick.shadowNote = `Shadow: EV alt → ${evPick.match.home.name} vs ${evPick.match.away.name} · ${evPick.marketLabel}`;
  } else {
    pick.shadowWouldSkip = false;
    pick.shadowNote = "Shadow: EV agrees with product pick";
  }

  return pick;
}
