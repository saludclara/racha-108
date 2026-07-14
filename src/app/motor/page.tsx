"use client";

import { SCORE_WEIGHTS, TILT_GUARD_HOURS } from "@/lib/engine";
import { useApp } from "@/lib/store";

const LAYERS = [
  {
    w: `${Math.round(SCORE_WEIGHTS.football * 100)}%`,
    title: "Probabilidad futbolística",
    body: "Dixon–Coles + Poisson: goles esperados, forma ponderada, ventaja local.",
  },
  {
    w: `${Math.round(SCORE_WEIGHTS.stats * 100)}%`,
    title: "Estudio y estadísticas",
    body: "xG, descanso, lesiones, motivación y fit del mercado.",
  },
  {
    w: `${Math.round(SCORE_WEIGHTS.value * 100)}%`,
    title: "Matemática de valor",
    body: "Edge vs implícita y Kelly fraccional solo como filtro.",
  },
  {
    w: `${Math.round(SCORE_WEIGHTS.numerology * 100)}%`,
    title: "Numerología",
    body: "Arcano mayor del día, número universal, camino de vida, vibración horaria, resonancia 11.11/108 y afinidad con el mercado.",
  },
  {
    w: `${Math.round(SCORE_WEIGHTS.stars * 100)}%`,
    title: "Estrellas",
    body: "Signo solar, fase lunar y atmósfera del día (modificador, no dominante).",
  },
];

export default function MotorPage() {
  const { state, ready, threshold, tiltActive } = useApp();
  if (!ready) return null;

  return (
    <div className="rise space-y-5">
      <header className="pt-3">
        <p className="section-label !normal-case !tracking-normal">Lab</p>
        <h1 className="large-title">Motor</h1>
        <p className="mt-1 text-[15px] text-[var(--muted)]">
          Cada ciclo fuerza 1 pick real: prioriza live/casi-FT y si no amplía
          la ventana. Sin partidos inventados. Liquidación con marcador oficial.
        </p>
      </header>

      <div className="ios-card p-5">
        <p className="text-[13px] text-[var(--muted)]">Umbral activo</p>
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
            Base {state.settings.scoreThreshold} · sin tilt guard.
          </p>
        )}
      </div>

      <div className="space-y-3">
        {LAYERS.map((l) => (
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
