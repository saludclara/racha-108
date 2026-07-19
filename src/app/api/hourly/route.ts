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
