"use client";

import { useState } from "react";
import {
  SCORE_WEIGHTS,
  TILT_GUARD_HOURS,
  computeMotorMetrics,
  evaluateQuality,
  historyToCsv,
} from "@/lib/engine";
import { useApp } from "@/lib/store";

const LAYERS = [
  {
    key: "football" as const,
    w: `${Math.round(SCORE_WEIGHTS.football * 100)}%`,
    title: "Probabilidad futbolística",
    body: "Dixon–Coles + Poisson: goles esperados, forma, homeAdv/rho por liga, ajuste live.",
  },
  {
    key: "stats" as const,
    w: `${Math.round(SCORE_WEIGHTS.stats * 100)}%`,
    title: "Estudio y estadísticas",
    body: "Form/records, xG proxy, descanso, lesiones y fit del mercado.",
  },
  {
    key: "value" as const,
    w: `${Math.round(SCORE_WEIGHTS.value * 100)}%`,
    title: "Matemática de valor",
    body: "Edge solo vs cuotas book. Sin book → neutro (nunca se finge con el modelo).",
  },
  {
    key: "numerology" as const,
    w: `${Math.round(SCORE_WEIGHTS.numerology * 100)}%`,
    title: "Numerología",
    body: "Tip visual · ≤3% del score. No decide el pick.",
  },
  {
    key: "stars" as const,
    w: `${Math.round(SCORE_WEIGHTS.stars * 100)}%`,
    title: "Estrellas",
    body: "Tip visual · ≤2% del score. No decide el pick.",
  },
];

function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export default function MotorPage() {
  const { state, ready, threshold, tiltActive } = useApp();
  const [mode, setMode] = useState<"grind" | "lore">("grind");
  if (!ready) return null;

  const pick = state.currentPick;
  const quality = pick ? evaluateQuality(pick) : null;
  const pBook =
    pick?.oddsSource === "book" && pick.bookOdds
      ? 1 / pick.bookOdds
      : null;
  const metrics = computeMotorMetrics(state.history, 200);
  const why = (pick?.layers ?? [])
    .filter((l) => mode === "lore" || (l.key !== "numerology" && l.key !== "stars"))
    .slice(0, 3);

  const visibleLayers =
    mode === "grind"
      ? LAYERS.filter((l) => l.key !== "numerology" && l.key !== "stars")
      : LAYERS;

  function exportCsv() {
    const csv = historyToCsv(state.history);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `racha-historial-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rise space-y-5">
      <header className="pt-3">
        <p className="section-label !normal-case !tracking-normal">Lab</p>
        <h1 className="large-title">Motor</h1>
        <p className="mt-1 text-[15px] text-[var(--muted)]">
          Ranking EV en ventana liquidable. Shadow week: el pick de producto
          sigue; se loguea si EV hubiera hecho SKIP. Lore ≤5% y fuera del rank.
          Env MOTOR_GUARANTEE=0 activa SKIP real.
        </p>
      </header>

      <div className="flex gap-2">
        <button
          type="button"
          className="pill"
          style={{
            background: mode === "grind" ? "var(--ios-blue)" : "var(--ios-fill)",
            color: mode === "grind" ? "#fff" : "var(--text)",
          }}
          onClick={() => setMode("grind")}
        >
          Modo Grind (EV)
        </button>
        <button
          type="button"
          className="pill"
          style={{
            background: mode === "lore" ? "var(--ios-blue)" : "var(--ios-fill)",
            color: mode === "lore" ? "#fff" : "var(--text)",
          }}
          onClick={() => setMode("lore")}
        >
          Modo Lore
        </button>
      </div>

      {pick ? (
        <div className="ios-card space-y-3 p-5">
          <p className="text-[13px] text-[var(--muted)]">Pick actual</p>
          <p className="text-[18px] font-semibold tracking-tight">
            {pick.match.home.name} vs {pick.match.away.name}
          </p>
          <p className="text-[14px] text-[var(--muted)]">
            {pick.marketLabel} · @{pick.odds.toFixed(2)} ·{" "}
            {pick.oddsSource === "book" ? "book" : "modelo"}
          </p>
          <div className="grid grid-cols-3 gap-3 pt-1">
            <div>
              <p className="text-[12px] text-[var(--muted)]">p_model</p>
              <p className="text-[22px] font-bold" style={{ color: "var(--ios-blue)" }}>
                {pct(pick.modelProb)}
              </p>
            </div>
            <div>
              <p className="text-[12px] text-[var(--muted)]">p_book</p>
              <p className="text-[22px] font-bold">{pct(pBook)}</p>
            </div>
            <div>
              <p className="text-[12px] text-[var(--muted)]">edge</p>
              <p
                className="text-[22px] font-bold"
                style={{
                  color:
                    pick.oddsSource === "book" && pick.edge >= 0
                      ? "var(--win, var(--ios-blue))"
                      : "var(--muted)",
                }}
              >
                {pick.oddsSource === "book"
                  ? `${pick.edge >= 0 ? "+" : ""}${(pick.edge * 100).toFixed(1)}pp`
                  : "n/a"}
              </p>
            </div>
          </div>
          {pick.shadowNote ? (
            <p
              className="text-[13px]"
              style={{
                color: pick.shadowWouldSkip ? "var(--warn)" : "var(--ios-blue)",
              }}
            >
              {pick.shadowNote}
            </p>
          ) : null}
          {quality ? (
            <p
              className="text-[13px]"
              style={{ color: quality.ok ? "var(--ios-blue)" : "var(--warn)" }}
            >
              {quality.ok
                ? "Filtros EV: OK"
                : `Filtros: ${quality.reasons.join(" · ")}`}
            </p>
          ) : null}
          {why.length ? (
            <div className="space-y-1 border-t border-[var(--line)] pt-3">
              <p className="text-[13px] font-medium">Por qué este pick</p>
              {why.map((l) => (
                <p key={l.key} className="text-[13px] text-[var(--muted)]">
                  · {l.note}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="ios-card p-5">
          <p className="text-[15px] text-[var(--muted)]">
            Sin pick activo. Un SKIP de calidad también es una decisión del
            ciclo.
          </p>
        </div>
      )}

      <div className="ios-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] text-[var(--muted)]">
              Métricas (últimos {metrics.window})
            </p>
            <p
              className="text-[34px] font-bold tracking-tight"
              style={{ color: "var(--ios-blue)" }}
            >
              {pct(metrics.hitRate, 0)}
            </p>
            <p className="mt-1 text-[13px] text-[var(--muted)]">
              {metrics.wins}W / {metrics.losses}L · {metrics.pushes} push ·{" "}
              {metrics.skips} skip
              {metrics.brier != null
                ? ` · Brier ${metrics.brier.toFixed(3)}`
                : ""}
              {metrics.avgEdge != null
                ? ` · edge medio ${(metrics.avgEdge * 100).toFixed(1)}pp`
                : ""}
            </p>
          </div>
          <button
            type="button"
            className="pill pill-auto shrink-0"
            onClick={exportCsv}
            disabled={!state.history.length}
          >
            Export CSV
          </button>
        </div>
        {metrics.byMarket.slice(0, 4).length > 0 ? (
          <div className="mt-3 space-y-1 border-t border-[var(--line)] pt-3">
            {metrics.byMarket.slice(0, 4).map((b) => (
              <p key={b.key} className="text-[13px] text-[var(--muted)]">
                {b.key}: {pct(b.hitRate, 0)} ({b.n})
              </p>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-[var(--muted)]">
            Pesos offline cuando N≥150 liquidaciones. Hoy: medir.
          </p>
        )}
      </div>

      <div className="ios-card p-5">
        <p className="text-[13px] text-[var(--muted)]">Umbral UI</p>
        <p
          className="text-[34px] font-bold tracking-tight"
          style={{ color: "var(--ios-blue)" }}
        >
          {threshold}
        </p>
        {tiltActive ? (
          <p className="mt-2 text-[14px]" style={{ color: "var(--warn)" }}>
            Tilt guard ON · +6 por {TILT_GUARD_HOURS}h tras una loss.
          </p>
        ) : (
          <p className="mt-2 text-[14px] text-[var(--muted)]">
            Base {state.settings.scoreThreshold} · el juez final es EV + filtros.
          </p>
        )}
      </div>

      <div className="space-y-3">
        {visibleLayers.map((l) => (
          <article key={l.title} className="ios-card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-semibold tracking-tight">{l.title}</h2>
              <span
                className="text-[13px] font-semibold"
                style={{ color: "var(--ios-blue)" }}
              >
                {l.w}
              </span>
            </div>
            <p className="mt-1 text-[14px] text-[var(--muted)]">{l.body}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
