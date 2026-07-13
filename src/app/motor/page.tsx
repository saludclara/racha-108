"use client";

import { TILT_GUARD_HOURS } from "@/lib/engine";
import { useApp } from "@/lib/store";

const LAYERS = [
  {
    w: "35%",
    title: "Probabilidad futbolística",
    body: "Poisson / Dixon-Coles simplificado: goles esperados, forma, ventaja local.",
  },
  {
    w: "25%",
    title: "Estudio y estadísticas",
    body: "xG, disparos, posesión, descanso, lesiones y motivación de partido.",
  },
  {
    w: "20%",
    title: "Matemática de valor",
    body: "Edge vs cuota implícita. Kelly fraccional solo como filtro, no para sizing.",
  },
  {
    w: "10%",
    title: "Numerología del día",
    body: "Capa simbólica: afinidad con 11.11 / 108. Nunca domina el pick.",
  },
  {
    w: "10%",
    title: "Estrellas / atmósfera",
    body: "Fase lunar y signo del día como modificador lúdico (±pequeño).",
  },
];

export default function MotorPage() {
  const { state, ready, threshold, tiltActive } = useApp();
  if (!ready) return null;

  return (
    <div className="rise space-y-6">
      <header>
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
          Lab
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Motor</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Solo mercados grind (cuotas ~1.05–1.25). Si nada supera el umbral → SKIP.
        </p>
      </header>

      <div className="glass rounded-3xl p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
              Umbral activo
            </p>
            <p className="text-3xl font-semibold text-[var(--accent)]">
              {threshold}
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="text-[var(--muted)]">Base settings</p>
            <p>{state.settings.scoreThreshold}</p>
          </div>
        </div>
        {tiltActive ? (
          <p className="mt-4 text-sm text-[var(--warn)]">
            Tilt guard ON tras una loss: umbral +6 durante {TILT_GUARD_HOURS}h.
            Vault intacto. HotStack reiniciado a 11.11.
          </p>
        ) : (
          <p className="mt-4 text-sm text-[var(--muted)]">
            Sin tilt guard. El motor opera en umbral base.
          </p>
        )}
      </div>

      <section className="space-y-3">
        {LAYERS.map((l) => (
          <article key={l.title} className="glass rounded-2xl p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-semibold">{l.title}</h2>
              <span className="font-[family-name:var(--font-mono)] text-xs text-[var(--accent)]">
                {l.w}
              </span>
            </div>
            <p className="mt-2 text-sm text-[var(--muted)]">{l.body}</p>
          </article>
        ))}
      </section>

      <p className="text-xs text-[var(--muted)]">
        Numerología y estrellas son flavor transparente: el gate real es
        probabilidad + stats + valor.
      </p>
    </div>
  );
}
