import { NextRequest, NextResponse } from "next/server";
import { buildHourlyPick, refreshPickSettlement } from "@/lib/data/real";
import type { ScoredPick } from "@/lib/engine/types";

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

export async function GET(req: NextRequest) {
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
    return NextResponse.json(data, {
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
    return NextResponse.json(data, {
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
