import { NextRequest, NextResponse } from "next/server";
import { buildHourlyPick, refreshPickSettlement } from "@/lib/data/real";
import type { SourceStatus } from "@/lib/data/providers/types";
import type { ScoredPick } from "@/lib/engine/types";
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

/** Hide provider error strings / key presence probes. */
function publicSources(sources: SourceStatus[] | undefined): SourceStatus[] {
  if (!sources?.length) return [];
  return sources.map((s) => ({
    id: s.id,
    label: s.label,
    enabled: s.enabled,
    configured: s.enabled ? true : false,
    ok: s.ok,
    count: s.count,
  }));
}

function withPublicSources<T extends { sources?: SourceStatus[] }>(data: T): T {
  if (!data.sources) return data;
  return { ...data, sources: publicSources(data.sources) };
}

export async function GET(req: NextRequest) {
  const denied =
    guardBrowserOrCron(req) ?? guardRateLimit(req, "hourly-get", 30, 60_000);
  if (denied) return denied;

  const hourKey = req.nextUrl.searchParams.get("hourKey");
  const threshold = Number(req.nextUrl.searchParams.get("threshold") ?? "82");

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
      pick?: ScoredPick;
      apiFootball?: boolean;
      oddsApi?: boolean;
      esports?: boolean;
    };
    if (!body.pick) {
      return NextResponse.json(
        { ok: false, error: "pick required" },
        { status: 400 },
      );
    }
    const data = await refreshPickSettlement(body.pick, new Date(), {
      enableApiFootball: body.apiFootball !== false,
      enableOddsApi: body.oddsApi !== false,
      enableEsports: body.esports !== false,
    });
    return NextResponse.json(withPublicSources(data), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("refresh settle failed", err);
    return NextResponse.json(
      { ok: false, error: "Error refrescando resultado real" },
      { status: 502 },
    );
  }
}
