import { NextRequest, NextResponse } from "next/server";
import { buildHourlyPick, refreshPickSettlement } from "@/lib/data/real";
import type { SourceStatus } from "@/lib/data/providers/types";
import type { HistoryEntry, ScoredPick } from "@/lib/engine/types";
import {
  guardBrowserOrCron,
  guardJsonBody,
  guardRateLimit,
} from "@/lib/api/request-guard";

export const dynamic = "force-dynamic";
export const revalidate = 0;
/** Allow ESPN multi-league fetch on Vercel (Fluid / Pro; hobby may still cap lower). */
export const maxDuration = 60;

function parseBool(v: string | null, fallback: boolean): boolean {
  if (v == null) return fallback;
  return v === "1" || v === "true";
}

function feedFromSearch(req: NextRequest) {
  return {
    enableApiFootball: parseBool(
      req.nextUrl.searchParams.get("apiFootball"),
      true,
    ),
    enableOddsApi: parseBool(req.nextUrl.searchParams.get("oddsApi"), true),
    enableEsports: parseBool(req.nextUrl.searchParams.get("esports"), true),
  };
}

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
  "outcome" | "league" | "provider" | "edge" | "modelProb"
>;

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
    out.push({
      id: `wire-${out.length}`,
      hourKey: "wire",
      at: new Date(0).toISOString(),
      outcome: r.outcome,
      stake: 0,
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

export async function GET(req: NextRequest) {
  const denied =
    guardBrowserOrCron(req) ?? guardRateLimit(req, "hourly-get", 30, 60_000);
  if (denied) return denied;

  const hourKey = req.nextUrl.searchParams.get("hourKey");
  const threshold = Number(req.nextUrl.searchParams.get("threshold") ?? "82");
  const tiltActive = parseBool(req.nextUrl.searchParams.get("tilt"), false);

  if (!hourKey) {
    return NextResponse.json(
      { ok: false, error: "hourKey required" },
      { status: 400 },
    );
  }

  try {
    const data = await buildHourlyPick(
      hourKey,
      Number.isFinite(threshold) ? threshold : 82,
      new Date(),
      feedFromSearch(req),
      { tiltActive },
    );
    return NextResponse.json(withPublicSources(data), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("hourly pick failed", err);
    return NextResponse.json(
      {
        ok: false,
        error: "No se pudo consultar el feed de partidos reales.",
      },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  const denied =
    guardBrowserOrCron(req) ??
    guardJsonBody(req) ??
    guardRateLimit(req, "hourly-post", 60, 60_000);
  if (denied) return denied;

  try {
    const body = (await req.json()) as {
      action?: "pick" | "refresh";
      hourKey?: string;
      threshold?: number;
      tiltActive?: boolean;
      history?: CompactHist[];
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

    // New-cycle pick with history (blacklist + tilt gates)
    if (body.action === "pick" || (body.hourKey && !body.pick)) {
      if (!body.hourKey) {
        return NextResponse.json(
          { ok: false, error: "hourKey required" },
          { status: 400 },
        );
      }
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
        },
      );
      return NextResponse.json(withPublicSources(data), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (!body.pick) {
      return NextResponse.json(
        { ok: false, error: "pick required" },
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
