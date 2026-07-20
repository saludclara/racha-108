import { NextRequest, NextResponse } from "next/server";
import { buildHourlyPick, refreshPickSettlement } from "@/lib/data/real";
import type { SourceStatus } from "@/lib/data/providers/types";
import type {
  HistoryEntry,
  Lesson,
  LessonAction,
  LessonCause,
  ScoredPick,
} from "@/lib/engine/types";
import {
  guardBrowserOrCron,
  guardJsonBody,
  guardRateLimit,
} from "@/lib/api/request-guard";

export const dynamic = "force-dynamic";
export const revalidate = 0;
/** Allow ESPN multi-league fetch on Vercel (Fluid / Pro; hobby may still cap lower). */
export const maxDuration = 60;

/** Safe public source status (no raw upstream dumps). */
function publicSources(sources: SourceStatus[] | undefined): SourceStatus[] {
  if (!sources?.length) return [];
  return sources.map((s) => {
    let error: string | undefined;
    if (!s.ok || s.error) {
      const raw = (s.error ?? "").toLowerCase();
      if (!s.configured) error = "sin key";
      else if (/limit|rate|request/.test(raw)) error = "límite free";
      else if (raw) error = "error de feed";
      else if (!s.ok) error = "error de feed";
    }
    return {
      id: s.id,
      label: s.label,
      enabled: s.enabled,
      configured: s.configured,
      ok: s.ok,
      count: s.count,
      error,
    };
  });
}

function withPublicSources<T extends { sources?: SourceStatus[] }>(data: T): T {
  if (!data.sources) return data;
  return { ...data, sources: publicSources(data.sources) };
}

type CompactHist = Pick<
  HistoryEntry,
  | "outcome"
  | "market"
  | "marketLabel"
  | "league"
  | "provider"
  | "edge"
  | "modelProb"
>;

const WIRE_MARKETS = new Set([
  "home_win",
  "double_chance_1x",
  "draw_no_bet_home",
  "under_25",
  "under_35",
  "btts_no",
  "ah_home_m025",
  "ah_home_m05",
] as const);

function asHistory(raw: unknown): HistoryEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: HistoryEntry[] = [];
  for (const row of raw.slice(0, 120)) {
    if (!row || typeof row !== "object") continue;
    const r = row as CompactHist;
    if (
      r.outcome !== "win" &&
      r.outcome !== "loss" &&
      r.outcome !== "push" &&
      r.outcome !== "skip" &&
      r.outcome !== "pending"
    ) {
      continue;
    }
    const market =
      typeof r.market === "string" && WIRE_MARKETS.has(r.market as never)
        ? (r.market as HistoryEntry["market"])
        : undefined;
    out.push({
      id: `wire-${out.length}`,
      hourKey: "wire",
      at: new Date(0).toISOString(),
      outcome: r.outcome,
      stake: 0,
      market,
      marketLabel:
        typeof r.marketLabel === "string" ? r.marketLabel : undefined,
      league: typeof r.league === "string" ? r.league : undefined,
      provider:
        r.provider === "espn" ||
        r.provider === "api-football" ||
        r.provider === "odds-api" ||
        r.provider === "pandascore"
          ? r.provider
          : undefined,
      edge: typeof r.edge === "number" ? r.edge : undefined,
      modelProb: typeof r.modelProb === "number" ? r.modelProb : undefined,
    });
  }
  return out.length ? out : undefined;
}

const WIRE_CAUSES = new Set<LessonCause>([
  "EDGE_FALSO",
  "MERCADO_TOXICO",
  "LIGA_DEBIL",
  "CAPA_MENTIRA",
  "PROB_HINCHADA",
  "TIMING_MALO",
  "VARIANCE",
]);

const WIRE_ACTIONS = new Set<LessonAction>([
  "coolMarket",
  "banMarket",
  "banLeague",
  "bumpEdge",
  "bumpThreshold",
  "demoteLayer",
  "raiseModelProb",
]);

function asLessons(raw: unknown): Lesson[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Lesson[] = [];
  for (const row of raw.slice(0, 40)) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id.slice(0, 80) : "";
    const cause = r.cause;
    const action = r.action;
    const target = typeof r.target === "string" ? r.target.slice(0, 160) : "";
    const expiresAt =
      typeof r.expiresAt === "string" ? r.expiresAt.slice(0, 64) : "";
    const createdAt =
      typeof r.createdAt === "string" ? r.createdAt.slice(0, 64) : "";
    if (!id || !target || !expiresAt || !createdAt) continue;
    if (typeof cause !== "string" || !WIRE_CAUSES.has(cause as LessonCause)) {
      continue;
    }
    if (typeof action !== "string" || !WIRE_ACTIONS.has(action as LessonAction)) {
      continue;
    }
    out.push({
      id,
      lossHistoryId:
        typeof r.lossHistoryId === "string"
          ? r.lossHistoryId.slice(0, 80)
          : id,
      cause: cause as LessonCause,
      plainWhy:
        typeof r.plainWhy === "string" ? r.plainWhy.slice(0, 320) : "",
      plainFix:
        typeof r.plainFix === "string" ? r.plainFix.slice(0, 320) : "",
      action: action as LessonAction,
      target,
      strength:
        typeof r.strength === "number" && Number.isFinite(r.strength)
          ? r.strength
          : 1,
      expiresAt,
      createdAt,
      market:
        typeof r.market === "string" && WIRE_MARKETS.has(r.market as never)
          ? (r.market as Lesson["market"])
          : undefined,
      league: typeof r.league === "string" ? r.league.slice(0, 120) : undefined,
    });
  }
  return out.length ? out : undefined;
}

export async function POST(req: NextRequest) {
  const denied =
    guardBrowserOrCron(req) ??
    guardJsonBody(req) ??
    guardRateLimit(req, "hourly-post", 60, 60_000);
  if (denied) return denied;

  try {
    const body = (await req.json()) as {
      hourKey?: string;
      threshold?: number;
      tiltActive?: boolean;
      history?: CompactHist[];
      lessons?: Lesson[];
      pick?: ScoredPick;
      apiFootball?: boolean;
      oddsApi?: boolean;
      esports?: boolean;
    };

    const feed = {
      enableApiFootball: body.apiFootball !== false,
      enableOddsApi: body.oddsApi !== false,
      enableEsports: body.esports !== false,
    };

    if (body.hourKey && !body.pick) {
      const threshold =
        typeof body.threshold === "number" && Number.isFinite(body.threshold)
          ? body.threshold
          : 82;
      const data = await buildHourlyPick(
        body.hourKey,
        threshold,
        new Date(),
        feed,
        {
          tiltActive: body.tiltActive === true,
          history: asHistory(body.history),
          lessons: asLessons(body.lessons),
        },
      );
      return NextResponse.json(withPublicSources(data), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (!body.pick) {
      return NextResponse.json(
        { ok: false, error: "hourKey or pick required" },
        { status: 400 },
      );
    }

    const data = await refreshPickSettlement(body.pick, new Date(), feed);
    return NextResponse.json(withPublicSources(data), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("hourly post failed", err);
    return NextResponse.json(
      { ok: false, error: "Error en /api/hourly" },
      { status: 502 },
    );
  }
}
