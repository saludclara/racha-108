import { NextResponse } from "next/server";
import { createInitialState } from "@/lib/engine";
import { adoptCloudState } from "@/lib/runs/merge";
import { normalizeAppState } from "@/lib/runs/normalize";
import {
  guardBrowserOrCron,
  guardJsonBody,
  guardRateLimit,
} from "@/lib/api/request-guard";
import {
  getSupabaseAdmin,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function notConfigured() {
  return NextResponse.json(
    { error: "Supabase no configurado" },
    { status: 503 },
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function genericDbError() {
  return NextResponse.json({ error: "Error de base de datos" }, { status: 500 });
}

export { normalizeAppState };

export async function GET(req: Request) {
  if (!isSupabaseConfigured()) return notConfigured();

  const denied = guardBrowserOrCron(req) ?? guardRateLimit(req, "run-get", 60, 60_000);
  if (denied) return denied;

  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("runs")
    .select("id, state, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[api/run GET]", error);
    return genericDbError();
  }
  if (!data) {
    return NextResponse.json({ error: "Run no encontrado" }, { status: 404 });
  }

  const state = normalizeAppState(data.state);
  if (!state) {
    return NextResponse.json({ error: "State inválido" }, { status: 500 });
  }

  return NextResponse.json({
    id: data.id as string,
    state,
    updatedAt: data.updated_at as string,
  });
}

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) return notConfigured();

  const denied =
    guardBrowserOrCron(req) ??
    guardJsonBody(req) ??
    guardRateLimit(req, "run-create", 30, 15 * 60_000);
  if (denied) return denied;

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const rawState = isPlainObject(body) ? body.state : undefined;
  const state =
    rawState === undefined
      ? createInitialState()
      : normalizeAppState(rawState);
  if (!state) {
    return NextResponse.json({ error: "state inválido" }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("runs")
    .insert({ state })
    .select("id, state, updated_at")
    .single();

  if (error || !data) {
    console.error("[api/run POST]", error);
    return NextResponse.json({ error: "No se pudo crear" }, { status: 500 });
  }

  return NextResponse.json({
    id: data.id as string,
    state: normalizeAppState(data.state) ?? state,
    updatedAt: data.updated_at as string,
  });
}

export async function PUT(req: Request) {
  if (!isSupabaseConfigured()) return notConfigured();

  const denied =
    guardBrowserOrCron(req) ??
    guardJsonBody(req) ??
    guardRateLimit(req, "run-put", 120, 60_000);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!isPlainObject(body)) {
    return NextResponse.json({ error: "body inválido" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const incoming = normalizeAppState(body.state);
  if (!incoming) {
    return NextResponse.json({ error: "state inválido" }, { status: 400 });
  }

  const expectedUpdatedAt =
    typeof body.expectedUpdatedAt === "string"
      ? body.expectedUpdatedAt.trim()
      : "";

  // Load current so history/ledger accumulate instead of being replaced
  const { data: cur, error: curErr } = await getSupabaseAdmin()
    .from("runs")
    .select("id, state, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (curErr) {
    console.error("[api/run PUT load]", curErr);
    return genericDbError();
  }
  if (!cur) {
    return NextResponse.json({ error: "Run no encontrado" }, { status: 404 });
  }

  if (expectedUpdatedAt && cur.updated_at !== expectedUpdatedAt) {
    const curState = normalizeAppState(cur.state);
    return NextResponse.json(
      {
        error: "conflict",
        id: cur.id as string,
        state: curState,
        updatedAt: cur.updated_at as string,
      },
      { status: 409 },
    );
  }

  const existing = normalizeAppState(cur.state);
  const state = existing ? adoptCloudState(existing, incoming) : incoming;

  const nowIso = new Date().toISOString();
  let query = getSupabaseAdmin()
    .from("runs")
    .update({ state, updated_at: nowIso })
    .eq("id", id);

  if (expectedUpdatedAt) {
    query = query.eq("updated_at", expectedUpdatedAt);
  }

  const { data, error } = await query
    .select("id, state, updated_at")
    .maybeSingle();

  if (error) {
    console.error("[api/run PUT]", error);
    return genericDbError();
  }

  if (!data) {
    // Race: another writer landed between load and update
    const { data: again } = await getSupabaseAdmin()
      .from("runs")
      .select("id, state, updated_at")
      .eq("id", id)
      .maybeSingle();

    if (!again) {
      return NextResponse.json({ error: "Run no encontrado" }, { status: 404 });
    }

    if (expectedUpdatedAt) {
      const curState = normalizeAppState(again.state);
      return NextResponse.json(
        {
          error: "conflict",
          id: again.id as string,
          state: curState,
          updatedAt: again.updated_at as string,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ error: "Run no encontrado" }, { status: 404 });
  }

  return NextResponse.json({
    id: data.id as string,
    state: normalizeAppState(data.state) ?? state,
    updatedAt: data.updated_at as string,
  });
}
