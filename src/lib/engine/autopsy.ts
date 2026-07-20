import { ALLOWED_MARKETS, MARKET_LABELS } from "./markets";
import { computeMotorMetrics, marketFromEntry } from "./metrics";
import type {
  HistoryEntry,
  LayerScore,
  Lesson,
  LessonAction,
  LessonCause,
  MarketType,
  ScoredPick,
} from "./types";

export const MAX_LESSONS = 40;

export type LessonEffects = {
  coolMarkets: Set<MarketType>;
  bannedMarkets: Set<MarketType>;
  bannedLeagues: Set<string>;
  /** Per-market edge floor bumps (not global). */
  edgeBumpByMarket: Map<MarketType, number>;
  /** Per-market modelProb floor bumps (not global). */
  modelProbBumpByMarket: Map<MarketType, number>;
  thresholdBump: number;
  demotedLayers: Set<LayerScore["key"]>;
};

const EMPTY_EFFECTS = (): LessonEffects => ({
  coolMarkets: new Set(),
  bannedMarkets: new Set(),
  bannedLeagues: new Set(),
  edgeBumpByMarket: new Map(),
  modelProbBumpByMarket: new Map(),
  thresholdBump: 0,
  demotedLayers: new Set(),
});

function asMarket(target: string): MarketType | null {
  if ((ALLOWED_MARKETS as string[]).includes(target)) {
    return target as MarketType;
  }
  return null;
}

function totalGoals(home?: number, away?: number): number | null {
  if (home == null || away == null) return null;
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return home + away;
}

function marketLineGoals(market: MarketType): number | null {
  if (market === "under_25") return 2.5;
  if (market === "under_35") return 3.5;
  return null;
}

function layerLied(
  pick: ScoredPick,
  homeScore?: number,
  awayScore?: number,
): LayerScore["key"] | null {
  const grind = (pick.layers ?? []).filter(
    (l) => l.key === "football" || l.key === "stats" || l.key === "value",
  );
  if (!grind.length) return null;
  const top = [...grind].sort((a, b) => b.score - a.score)[0];
  if (!top || top.score < 78) return null;

  const goals = totalGoals(homeScore, awayScore);
  const line = marketLineGoals(pick.market);

  if (top.key === "value" && pick.oddsSource === "book" && pick.edge >= 0.02) {
    return "value";
  }
  if (
    top.key === "stats" &&
    line != null &&
    goals != null &&
    goals > line
  ) {
    return "stats";
  }
  if (top.key === "football" && pick.modelProb >= 0.8) {
    return "football";
  }
  return top.score >= 88 ? top.key : null;
}

function leagueIsWeak(
  history: HistoryEntry[],
  league: string | undefined,
): boolean {
  if (!league) return false;
  const m = computeMotorMetrics(history, 80);
  const b = m.byLeague.find((x) => x.key === league);
  return Boolean(b && b.n >= 3 && b.hitRate != null && b.hitRate < 0.4);
}

function recentMarketLosses(
  history: HistoryEntry[],
  market: MarketType,
): number {
  let n = 0;
  for (const h of history.slice(0, 12)) {
    if (h.outcome !== "loss") continue;
    if (marketFromEntry(h) === market) n += 1;
  }
  return n;
}

function scoreLine(home?: number, away?: number): string {
  if (home == null || away == null) return "sin marcador";
  return `${home}-${away}`;
}

function classifyCause(
  pick: ScoredPick,
  history: HistoryEntry[],
  homeScore?: number,
  awayScore?: number,
): LessonCause {
  // Match facts first — what the scoreboard proved.
  const goals = totalGoals(homeScore, awayScore);
  const line = marketLineGoals(pick.market);
  if (line != null && goals != null && goals > line) {
    return "MERCADO_TOXICO";
  }
  if (
    pick.market === "btts_no" &&
    homeScore != null &&
    awayScore != null &&
    homeScore > 0 &&
    awayScore > 0
  ) {
    return "MERCADO_TOXICO";
  }

  // Selection audit — we should have SKIP'd.
  if (pick.shadowWouldSkip) return "EDGE_FALSO";
  if (
    pick.oddsSource === "book" &&
    typeof pick.edge === "number" &&
    pick.edge < 0.02
  ) {
    return "EDGE_FALSO";
  }

  if (leagueIsWeak(history, pick.match.league)) return "LIGA_DEBIL";

  if (pick.modelProb >= 0.86) return "PROB_HINCHADA";

  if (
    pick.match.status === "inplay" ||
    (typeof pick.match.minute === "number" && pick.match.minute >= 20)
  ) {
    return "TIMING_MALO";
  }

  if (layerLied(pick, homeScore, awayScore)) return "CAPA_MENTIRA";

  return "VARIANCE";
}

function remedyFor(
  cause: LessonCause,
  pick: ScoredPick,
  history: HistoryEntry[],
  homeScore?: number,
  awayScore?: number,
): {
  action: LessonAction;
  target: string;
  strength: number;
  ttlHours: number;
  plainWhy: string;
  plainFix: string;
} {
  const market = pick.market;
  const label = pick.marketLabel || MARKET_LABELS[market];
  const ft = scoreLine(homeScore, awayScore);
  const match = `${pick.match.home.name} vs ${pick.match.away.name}`;
  const priorMarketL = recentMarketLosses(history, market);

  switch (cause) {
    case "EDGE_FALSO": {
      return {
        action: "bumpEdge",
        target: market,
        strength: 0.015,
        ttlHours: 36,
        plainWhy: `Apostamos ${label} en ${match}. El “valor” del libro era débil (edge ${(pick.edge * 100).toFixed(1)}pp). Terminó ${ft}.`,
        plainFix: `Pedimos más edge en ${label} por un tiempo. Sin valor claro → SKIP.`,
      };
    }
    case "MERCADO_TOXICO": {
      const ban = priorMarketL >= 1;
      return {
        action: ban ? "banMarket" : "coolMarket",
        target: market,
        strength: 1,
        ttlHours: ban ? 72 : 36,
        plainWhy: `Apostamos ${label} en ${match}. El partido explotó contra el mercado (FT ${ft}).`,
        plainFix: ban
          ? `Bloqueamos ${label} un rato. No lo tocamos hasta que expire la lección.`
          : `Enfriamos ${label}: cuesta más elegirlo y pedimos más calidad.`,
      };
    }
    case "LIGA_DEBIL": {
      const league = pick.match.league || "esa liga";
      return {
        action: "banLeague",
        target: league,
        strength: 1,
        ttlHours: 48,
        plainWhy: `Perdimos en ${league} (${match}, ${ft}). En esa liga venimos flojos.`,
        plainFix: `Evitamos ${league} un tiempo. Buscamos partidos en ligas más sanas.`,
      };
    }
    case "CAPA_MENTIRA": {
      const layer = layerLied(pick, homeScore, awayScore) ?? "stats";
      const layerName =
        layer === "football"
          ? "probabilidad"
          : layer === "value"
            ? "valor"
            : "estadísticas";
      return {
        action: "demoteLayer",
        target: layer,
        strength: 0.5,
        ttlHours: 36,
        plainWhy: `La capa de ${layerName} nos empujó a ${label} en ${match}. FT ${ft}: esa capa mintió.`,
        plainFix: `Bajamos el peso de ${layerName} un rato y subimos el listón del score.`,
      };
    }
    case "PROB_HINCHADA": {
      return {
        action: "raiseModelProb",
        target: market,
        strength: 0.03,
        ttlHours: 36,
        plainWhy: `El modelo dijo ${(pick.modelProb * 100).toFixed(0)}% en ${label} (${match}). FT ${ft}: iba hinchado.`,
        plainFix: `Exigimos más certeza del modelo en ${label} antes de apostar.`,
      };
    }
    case "TIMING_MALO": {
      return {
        action: "bumpThreshold",
        target: "global",
        strength: 4,
        ttlHours: 24,
        plainWhy: `Entramos en mal momento en ${match} (${label}). FT ${ft}. Había ruido de timing.`,
        plainFix: `Subimos el umbral de score: solo picks más limpios pasan.`,
      };
    }
    case "VARIANCE":
    default: {
      return {
        action: "coolMarket",
        target: market,
        strength: 1,
        ttlHours: 24,
        plainWhy: `Apostamos ${label} en ${match}. FT ${ft}. El partido nos ganó sin un fallo obvio del motor.`,
        plainFix: `Enfriamos ${label} por precaución. No repetimos el mismo golpe seguido.`,
      };
    }
  }
}

/** Build Autopsia lesson + hypersimple copy for one loss. */
export function buildLossLesson(
  pick: ScoredPick,
  history: HistoryEntry[],
  lossHistoryId: string,
  now = new Date(),
): Lesson {
  const homeScore = pick.match.homeScore;
  const awayScore = pick.match.awayScore;
  const cause = classifyCause(pick, history, homeScore, awayScore);
  const remedy = remedyFor(cause, pick, history, homeScore, awayScore);
  const expiresAt = new Date(
    now.getTime() + remedy.ttlHours * 60 * 60 * 1000,
  ).toISOString();

  return {
    id: `lesson-${now.getTime()}`,
    lossHistoryId,
    cause,
    plainWhy: remedy.plainWhy,
    plainFix: remedy.plainFix,
    action: remedy.action,
    target: remedy.target,
    strength: remedy.strength,
    expiresAt,
    createdAt: now.toISOString(),
    homeScore,
    awayScore,
    market: pick.market,
    league: pick.match.league,
    matchLabel: `${pick.match.home.name} vs ${pick.match.away.name}`,
  };
}

export function isLessonActive(lesson: Lesson, now = new Date()): boolean {
  return now.getTime() < new Date(lesson.expiresAt).getTime();
}

export function activeLessons(
  lessons: Lesson[] | undefined,
  now = new Date(),
): Lesson[] {
  if (!lessons?.length) return [];
  return lessons.filter((l) => isLessonActive(l, now));
}

/** Keep active + recently expired (for UI), capped. */
export function pruneLessons(
  lessons: Lesson[],
  now = new Date(),
  max = MAX_LESSONS,
): Lesson[] {
  const keepMs = 14 * 24 * 60 * 60 * 1000;
  const cutoff = now.getTime() - keepMs;
  return lessons
    .filter((l) => new Date(l.expiresAt).getTime() > cutoff || isLessonActive(l, now))
    .sort((a, b) => (b.createdAt < a.createdAt ? -1 : 1))
    .slice(0, max);
}

/** Translate active lessons into concrete pick-engine effects. */
export function lessonEffects(
  lessons: Lesson[] | undefined,
  now = new Date(),
): LessonEffects {
  const fx = EMPTY_EFFECTS();
  for (const l of activeLessons(lessons, now)) {
    switch (l.action) {
      case "coolMarket":
        fx.coolMarkets.add(l.target as MarketType);
        break;
      case "banMarket":
        fx.bannedMarkets.add(l.target as MarketType);
        break;
      case "banLeague":
        fx.bannedLeagues.add(l.target);
        break;
      case "bumpEdge": {
        const mk = asMarket(l.target);
        if (mk) {
          fx.edgeBumpByMarket.set(
            mk,
            Math.max(fx.edgeBumpByMarket.get(mk) ?? 0, l.strength),
          );
        }
        break;
      }
      case "raiseModelProb": {
        const mk = asMarket(l.target);
        if (mk) {
          fx.modelProbBumpByMarket.set(
            mk,
            Math.max(fx.modelProbBumpByMarket.get(mk) ?? 0, l.strength),
          );
        }
        break;
      }
      case "bumpThreshold":
        fx.thresholdBump = Math.max(fx.thresholdBump, l.strength);
        break;
      case "demoteLayer":
        if (
          l.target === "football" ||
          l.target === "stats" ||
          l.target === "value" ||
          l.target === "numerology" ||
          l.target === "stars"
        ) {
          fx.demotedLayers.add(l.target);
          fx.thresholdBump = Math.max(fx.thresholdBump, 3);
        }
        break;
      default:
        break;
    }
  }
  return fx;
}

/** Merge cool/ban markets only — league bans stay hard-filtered separately. */
export function mergeLessonEffects(
  into: SoftBlacklistLike,
  fx: LessonEffects,
): SoftBlacklistLike {
  for (const m of fx.coolMarkets) into.coolMarkets.add(m);
  for (const m of fx.bannedMarkets) into.markets.add(m);
  return into;
}

type SoftBlacklistLike = {
  leagues: Set<string>;
  markets: Set<MarketType>;
  coolMarkets: Set<MarketType>;
};

/** Gates for one market: base tilt/loss floors + Autopsia per-market bumps. */
export function gatesWithMarketLessons(
  base: { minModelProb: number; minEdgeBook: number; maxModelProb: number },
  market: MarketType,
  fx: LessonEffects,
): { minModelProb: number; minEdgeBook: number; maxModelProb: number } {
  const edgeBump = fx.edgeBumpByMarket.get(market) ?? 0;
  const probBump = fx.modelProbBumpByMarket.get(market) ?? 0;
  return {
    maxModelProb: base.maxModelProb,
    minEdgeBook: base.minEdgeBook + edgeBump,
    minModelProb: Math.min(0.92, base.minModelProb + probBump),
  };
}
