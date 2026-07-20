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
import {
  gatesWithMarketLessons,
  lessonEffects,
  mergeLessonEffects,
  type LessonEffects,
} from "./autopsy";
import {
  consecutiveLossCount,
  softBlacklists,
  type SoftBlacklist,
} from "./metrics";
import { isDeepLive } from "./eligibility";
import { isMarketLockedByScores } from "./settle";
import type {
  HistoryEntry,
  LayerScore,
  Lesson,
  MarketType,
  MatchCandidate,
  OddsSource,
  ScoredPick,
} from "./types";

const WEIGHTS = SCORE_WEIGHTS;

/** Hard filters for quality EV (book-only product path). */
const MIN_MODEL_PROB = 0.78;
const MIN_EDGE_BOOK = 0.02;
const MAX_MODEL_PROB = 0.92;
/** Model fills only (soft/forced debug) — not the book value band. */
const MODEL_MIN_ODDS = 1.08;
const MODEL_MAX_ODDS = 1.35;

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
function grindScore(
  layers: LayerScore[],
  demoted?: Set<LayerScore["key"]>,
): number {
  let sum = 0;
  let w = 0;
  for (const l of layers) {
    if (l.key === "numerology" || l.key === "stars") continue;
    const weight = demoted?.has(l.key) ? l.weight * 0.5 : l.weight;
    sum += l.score * weight;
    w += weight;
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
  if (odds > 1.7) score = Math.min(score, 62);
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

type QualityGates = {
  minModelProb: number;
  minEdgeBook: number;
  maxModelProb: number;
};

/**
 * Tilt + consecutive losses raise EV gates.
 * Per-market Autopsia bumps applied later via gatesWithMarketLessons.
 * After 2 losses: edge ≥4.5pp and higher modelProb floor.
 */
function qualityGatesFor(
  tiltActive: boolean,
  lossStreak = 0,
): QualityGates {
  let minModelProb = MIN_MODEL_PROB;
  let minEdgeBook = MIN_EDGE_BOOK;
  if (tiltActive) {
    minModelProb = Math.min(0.9, MIN_MODEL_PROB + 0.04);
    minEdgeBook = MIN_EDGE_BOOK + 0.01;
  }
  if (lossStreak >= 2) {
    minModelProb = Math.min(0.9, Math.max(minModelProb, MIN_MODEL_PROB + 0.06));
    minEdgeBook = Math.max(minEdgeBook, MIN_EDGE_BOOK + 0.025);
  }
  return {
    minModelProb,
    minEdgeBook,
    maxModelProb: MAX_MODEL_PROB,
  };
}

export type QualityGate = {
  ok: boolean;
  reasons: string[];
};

/** Whether EV/quality filters would accept this candidate (book + edge). */
export function evaluateQuality(
  pick: ScoredPick,
  gates: QualityGates = qualityGatesFor(false),
): QualityGate {
  const reasons: string[] = [];
  if (pick.oddsSource !== "book") {
    reasons.push("no_book");
  } else {
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
  }
  if (pick.modelProb > gates.maxModelProb) {
    reasons.push(
      `p_model ${(pick.modelProb * 100).toFixed(1)}% > ${(gates.maxModelProb * 100).toFixed(0)}% (lock)`,
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
  if (odds == null) return null;

  if (match.status === "finished") return null;
  if (isDeepLive(match, now)) return null;
  if (isMarketLockedByScores(market, match.homeScore, match.awayScore)) {
    return null;
  }

  const source = oddsSourceFor(match, market);
  // Quality path is book-only; model odds never place HotStack.
  if (opts.strict && source !== "book") return null;
  if (source === "book") {
    if (!isOddsInRange(odds)) return null;
  } else if (odds < MODEL_MIN_ODDS || odds > MODEL_MAX_ODDS) {
    return null;
  }

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
    if (modelProb > gates.maxModelProb) return null;
    if (opts.strict) {
      if (modelProb < gates.minModelProb) return null;
      if (edge < gates.minEdgeBook) return null;
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
    : `SKIP: ${quality.reasons.join("; ")}`;

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

/** Primary rank: book → edge → grind → market (cool markets demoted). */
function rankPicks(
  list: ScoredPick[],
  coolMarkets?: Set<MarketType>,
): ScoredPick[] {
  const cool = coolMarkets ?? new Set<MarketType>();
  return [...list].sort((a, b) => {
    const aBook = a.oddsSource === "book" ? 1 : 0;
    const bBook = b.oddsSource === "book" ? 1 : 0;
    if (bBook !== aBook) return bBook - aBook;
    if (b.edge !== a.edge) return b.edge - a.edge;
    const ag = grindScore(a.layers);
    const bg = grindScore(b.layers);
    if (bg !== ag) return bg - ag;
    const ap = (marketPriority[a.market] ?? 0) - (cool.has(a.market) ? 8 : 0);
    const bp = (marketPriority[b.market] ?? 0) - (cool.has(b.market) ? 8 : 0);
    return bp - ap;
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

/** Hard Autopsia league ban — never soft-falls back to banned leagues. */
function filterBannedLeagues(
  matches: MatchCandidate[],
  bannedLeagues: Set<string>,
): MatchCandidate[] {
  if (!bannedLeagues.size) return matches;
  return matches.filter((m) => !m.league || !bannedLeagues.has(m.league));
}

function collectCandidates(
  matches: MatchCandidate[],
  hourKey: string,
  now: Date,
  baseGates: QualityGates,
  guarantee: boolean,
  bannedMarkets?: Set<MarketType>,
  fx?: LessonEffects,
): { quality: ScoredPick[]; soft: ScoredPick[]; forced: ScoredPick[] } {
  const quality: ScoredPick[] = [];
  const soft: ScoredPick[] = [];
  const forced: ScoredPick[] = [];
  const banned = bannedMarkets ?? new Set<MarketType>();
  const effects = fx ?? lessonEffects([]);

  for (const match of matches) {
    for (const market of ALLOWED_MARKETS) {
      if (banned.has(market)) continue;
      const gates = gatesWithMarketLessons(baseGates, market, effects);
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
  coolMarkets?: Set<MarketType>,
  demoted?: Set<LayerScore["key"]>,
): ScoredPick | null {
  // Product path: must clear grind threshold (no p≥0.88 / quality fallback).
  const primary = quality.filter(
    (p) => grindScore(p.layers, demoted) >= threshold,
  );
  if (primary.length) return rankPicks(primary, coolMarkets)[0];
  if (!guarantee) return null;
  if (soft.length) return rankPicks(soft, coolMarkets)[0];
  if (forced.length) return rankPicks(forced, coolMarkets)[0];
  return null;
}

export type PickBestOptions = {
  /**
   * Default off: real quality SKIP when no book+edge pick.
   * Set true (or MOTOR_GUARANTEE=1) to force soft/forced shadow picks.
   */
  guarantee?: boolean;
  tiltActive?: boolean;
  history?: HistoryEntry[];
  /** Active Autopsia lessons (cool/ban/gate bumps). */
  lessons?: Lesson[];
};

/** Concrete SKIP codes for UI / cron messages. */
export type SkipReason =
  | "empty_pool"
  | "no_book"
  | "deep_live"
  | "edge"
  | "decided"
  | "threshold";

export type PickBestResult = {
  pick: ScoredPick | null;
  skipReason: SkipReason | null;
};

function resolveGuarantee(opts: PickBestOptions): boolean {
  if (typeof opts.guarantee === "boolean") return opts.guarantee;
  // Opt-in shadow force-pick for debug
  return process.env.MOTOR_GUARANTEE === "1";
}

/** Why quality book picks failed this cycle (for observability). */
function diagnoseSkipReason(
  pool: MatchCandidate[],
  hourKey: string,
  now: Date,
  gates: QualityGates,
  threshold: number,
): SkipReason {
  if (!pool.length) return "empty_pool";

  let sawBookInBand = false;
  let deep = 0;
  let decided = 0;
  let edgeFail = 0;
  let belowThreshold = 0;

  for (const match of pool) {
    for (const market of ALLOWED_MARKETS) {
      const odds = match.odds[market];
      if (odds == null) continue;
      if (oddsSourceFor(match, market) !== "book") continue;
      if (!isOddsInRange(odds)) continue;
      sawBookInBand = true;

      if (match.status === "finished") {
        decided++;
        continue;
      }
      if (isDeepLive(match, now)) {
        deep++;
        continue;
      }
      if (isMarketLockedByScores(market, match.homeScore, match.awayScore)) {
        decided++;
        continue;
      }

      const modelProb = marketModelProb(
        market,
        match.home,
        match.away,
        modelCtx(match),
      );
      const edge = modelProb - 1 / odds;
      if (
        modelProb > gates.maxModelProb ||
        modelProb < gates.minModelProb ||
        edge < gates.minEdgeBook
      ) {
        edgeFail++;
        continue;
      }

      const candidate = buildScoredPick(match, market, hourKey, now, {
        strict: true,
        gates,
      });
      if (!candidate) {
        edgeFail++;
        continue;
      }
      if (grindScore(candidate.layers) < threshold) {
        belowThreshold++;
      }
    }
  }

  if (!sawBookInBand) return "no_book";
  if (belowThreshold > 0 && edgeFail === 0 && deep === 0 && decided === 0) {
    return "threshold";
  }
  if (edgeFail > 0) return "edge";
  if (decided > 0 && deep === 0) return "decided";
  if (deep > 0) return "deep_live";
  if (belowThreshold > 0) return "threshold";
  if (decided > 0) return "decided";
  return "no_book";
}

/**
 * Best settleable-window grind pick + concrete SKIP reason.
 * Default: book + edge + grind threshold, else null.
 */
export function choosePickForHour(
  matches: MatchCandidate[],
  hourKey: string,
  threshold: number,
  now = new Date(),
  opts: PickBestOptions = {},
): PickBestResult {
  if (!matches.length) {
    return { pick: null, skipReason: "empty_pool" };
  }

  const guarantee = resolveGuarantee(opts);
  const history = opts.history ?? [];
  const lossStreak = consecutiveLossCount(history);
  const fx = lessonEffects(opts.lessons, now);
  const gates = qualityGatesFor(Boolean(opts.tiltActive), lossStreak);
  let bl: SoftBlacklist | null = history.length
    ? softBlacklists(history)
    : null;
  if (fx.coolMarkets.size || fx.bannedMarkets.size) {
    bl = bl ?? {
      leagues: new Set(),
      providers: new Set(),
      markets: new Set(),
      coolMarkets: new Set(),
    };
    mergeLessonEffects(bl, fx);
  }
  // Soft history blacklist may fall back; Autopsia league bans never do.
  const softFiltered = filterBlacklisted(matches, bl);
  const afterSoft = softFiltered.length ? softFiltered : matches;
  const pool = filterBannedLeagues(afterSoft, fx.bannedLeagues);
  if (!pool.length) {
    return { pick: null, skipReason: "empty_pool" };
  }

  const bannedMarkets = new Set<MarketType>([
    ...(bl?.markets ?? []),
    ...fx.bannedMarkets,
  ]);
  const coolMarkets = new Set<MarketType>([
    ...(bl?.coolMarkets ?? []),
    ...fx.coolMarkets,
  ]);
  const demoted = fx.demotedLayers;

  // Pure EV candidate (what we would do with guarantee off)
  const evBuckets = collectCandidates(
    pool,
    hourKey,
    now,
    gates,
    false,
    bannedMarkets,
    fx,
  );
  const evPick = selectFromBuckets(
    evBuckets.quality,
    evBuckets.soft,
    evBuckets.forced,
    threshold,
    false,
    coolMarkets,
    demoted,
  );

  if (!guarantee) {
    if (!evPick) {
      return {
        pick: null,
        skipReason: diagnoseSkipReason(pool, hourKey, now, gates, threshold),
      };
    }
    evPick.shadowWouldSkip = false;
    const coolBit =
      coolMarkets.has(evPick.market) ? " · mercado en cool" : "";
    const lessonBit =
      fx.coolMarkets.size ||
      fx.bannedMarkets.size ||
      fx.bannedLeagues.size ||
      fx.edgeBumpByMarket.size ||
      fx.modelProbBumpByMarket.size ||
      fx.thresholdBump ||
      fx.demotedLayers.size
        ? " · autopsia"
        : "";
    const banNote =
      lossStreak >= 2 ? ` · post ${lossStreak}L gates` : "";
    evPick.shadowNote = `EV mode · pick taken${banNote}${coolBit}${lessonBit}`;
    return { pick: evPick, skipReason: null };
  }

  // Product pick may fall back to soft/forced
  const prodBuckets = collectCandidates(
    pool,
    hourKey,
    now,
    gates,
    true,
    bannedMarkets,
    fx,
  );
  const pick = selectFromBuckets(
    prodBuckets.quality,
    prodBuckets.soft,
    prodBuckets.forced,
    threshold,
    true,
    coolMarkets,
    demoted,
  );
  if (!pick) {
    return {
      pick: null,
      skipReason: diagnoseSkipReason(pool, hourKey, now, gates, threshold),
    };
  }

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

  return { pick, skipReason: null };
}

/** Convenience wrapper — prefer choosePickForHour when SKIP reason matters. */
export function pickBestForHour(
  matches: MatchCandidate[],
  hourKey: string,
  threshold: number,
  now = new Date(),
  opts: PickBestOptions = {},
): ScoredPick | null {
  return choosePickForHour(matches, hourKey, threshold, now, opts).pick;
}
