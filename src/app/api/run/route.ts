import { NextResponse } from "next/server";
import { createInitialState, type AppState } from "@/lib/engine";
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

/** Minimal shape check + merge with defaults so old/partial payloads stay usable. */
export function normalizeAppState(raw: unknown): AppState | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.hotStack !== "number" || typeof raw.vault !== "number") {
    return null;
  }
  if (!isPlainObject(raw.settings)) return null;

  const base = createInitialState();
  return {
    ...base,
    ...(raw as Partial<AppState>),
    settings: {
      ...base.settings,
      ...(raw.settings as Partial<AppState["settings"]>),
    },
    history: Array.isArray(raw.history)
      ? (raw.history as AppState["history"])
      : base.history,
    vaultLedger: Array.isArray(raw.vaultLedger)
      ? (raw.vaultLedger as AppState["vaultLedger"])
      : base.vaultLedger,
  };
}

export async function GET(req: Request) {
  if (!isSupabaseConfigured()) return notConfigured();

  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("runs")
    .select("id, state")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[api/run GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Run no encontrado" }, { status: 404 });
  }

  const state = normalizeAppState(data.state);
  if (!state) {
    return NextResponse.json({ error: "State inválido" }, { status: 500 });
  }

  return NextResponse.json({ id: data.id as string, state });
}

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) return notConfigured();

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
    .select("id, state")
    .single();

  if (error || !data) {
    console.error("[api/run POST]", error);
    return NextResponse.json(
      { error: error?.message ?? "No se pudo crear" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    id: data.id as string,
    state: normalizeAppState(data.state) ?? state,
  });
}

export async function PUT(req: Request) {
  if (!isSupabaseConfigured()) return notConfigured();

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

  const state = normalizeAppState(body.state);
  if (!state) {
    return NextResponse.json({ error: "state inválido" }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("runs")
    .update({ state, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, state")
    .maybeSingle();

  if (error) {
    console.error("[api/run PUT]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Run no encontrado" }, { status: 404 });
  }

  return NextResponse.json({
    id: data.id as string,
    state: normalizeAppState(data.state) ?? state,
  });
}
