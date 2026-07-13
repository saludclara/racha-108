import { NextRequest, NextResponse } from "next/server";
import { buildHourlyPick, refreshPickSettlement } from "@/lib/data/real";
import type { ScoredPick } from "@/lib/engine/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
    );
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("hourly pick failed", err);
    return NextResponse.json(
      {
        ok: false,
        error: "No se pudo consultar partidos reales (ESPN).",
      },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { pick?: ScoredPick };
    if (!body.pick) {
      return NextResponse.json(
        { ok: false, error: "pick required" },
        { status: 400 },
      );
    }
    const data = await refreshPickSettlement(body.pick);
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
