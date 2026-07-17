import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { fetchAllMatches } from "@/lib/data/providers/registry";
import { processRunCycle } from "@/lib/cron/process-run";
import { normalizeAppState } from "@/lib/runs/normalize";
import {
  getSupabaseAdmin,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const PAGE_SIZE = 50;
const MAX_RUNS_PER_INVOKE = 500;

function authorize(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.get("authorization") ?? "";
  if (secret) {
    const expected = `Bearer ${secret}`;
    if (auth.length !== expected.length) return false;
    try {
      return timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
    } catch {
      return false;
    }
  }
  // Local / unset secret: allow only outside production
  return process.env.NODE_ENV !== "production";
}

type ActionBucket = Record<string, number>;

function bump(bucket: ActionBucket, action: string) {
  const kind = action.split(":")[0] || action;
  bucket[kind] = (bucket[kind] ?? 0) + 1;
}

/**
 * Cycle worker for durable runs (settle → catch-up → new pick).
 * Hobby can't use sub-daily Vercel Cron — call this from an external
 * scheduler every ~15m with Authorization: Bearer CRON_SECRET.
 */
export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase no configurado" },
      { status: 503 },
    );
  }

  const now = new Date();
  const started = Date.now();
  const writeAt = now.toISOString();

  let snapshot;
  try {
    snapshot = await fetchAllMatches({
      now,
      enableApiFootball: true,
      enableOddsApi: true,
      enableEsports: true,
    });
  } catch (err) {
    console.error("[cron/cycle] feed failed", err);
    return NextResponse.json(
      { ok: false, error: "No se pudo obtener el feed de partidos" },
      { status: 502 },
    );
  }

  const supabase = getSupabaseAdmin();
  let offset = 0;
  let runCount = 0;
  let changed = 0;
  let conflicts = 0;
  let errors = 0;
  const actionCounts: ActionBucket = {};

  while (offset < MAX_RUNS_PER_INVOKE) {
    const end = Math.min(offset + PAGE_SIZE - 1, MAX_RUNS_PER_INVOKE - 1);
    const { data: rows, error } = await supabase
      .from("runs")
      .select("id, state, updated_at")
      // Stable key — avoid skipping rows when we bump updated_at mid-loop
      .order("created_at", { ascending: true })
      .range(offset, end);

    if (error) {
      console.error("[cron/cycle] list runs", error);
      return NextResponse.json(
        { ok: false, error: "Error listando runs" },
        { status: 500 },
      );
    }

    if (!rows?.length) break;

    for (const row of rows) {
      runCount += 1;
      const id = row.id as string;
      const prevUpdated = row.updated_at as string;
      const state = normalizeAppState(row.state);
      if (!state) {
        errors += 1;
        continue;
      }

      try {
        const result = await processRunCycle(id, state, snapshot, now);
        for (const a of result.actions) bump(actionCounts, a);

        if (!result.changed) continue;

        const { data: saved, error: upErr } = await supabase
          .from("runs")
          .update({
            state: result.state,
            updated_at: writeAt,
          })
          .eq("id", id)
          .eq("updated_at", prevUpdated)
          .select("id")
          .maybeSingle();

        if (upErr) {
          console.error("[cron/cycle] save", id.slice(0, 8), upErr);
          errors += 1;
          continue;
        }
        if (!saved) {
          conflicts += 1;
          continue;
        }
        changed += 1;
      } catch (err) {
        console.error("[cron/cycle] process", id.slice(0, 8), err);
        errors += 1;
      }
    }

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  // No run UUIDs — capability tokens stay out of cron logs.
  return NextResponse.json({
    ok: true,
    at: now.toISOString(),
    matchCount: snapshot.matches.length,
    sources: snapshot.sources.map((s) => ({
      id: s.id,
      ok: s.ok,
      count: s.count,
      error: s.error
        ? /limit|rate|request/i.test(s.error)
          ? "límite free"
          : "error de feed"
        : undefined,
    })),
    runCount,
    changed,
    conflicts,
    errors,
    actionCounts,
    ms: Date.now() - started,
  });
}
