"use client";

import { STREAK_GOAL } from "@/lib/engine";
import { useApp } from "@/lib/store";

export default function RachaPage() {
  const { state, ready } = useApp();
  if (!ready) return null;

  const slots = Array.from({ length: STREAK_GOAL }, (_, i) => i + 1);
  const wins = state.history.filter((h) => h.outcome === "win").slice(0, state.streak);

  return (
    <div className="rise space-y-6">
      <header>
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
          Timeline
        </p>
        <h1 className="mt-1 text-3xl font-semibold">
          Racha {state.streak}/{STREAK_GOAL}
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Mejor racha: {state.bestStreak}. Los SKIP no rompen la racha; una loss sí.
        </p>
      </header>

      <div className="grid grid-cols-12 gap-1.5 sm:gap-2">
        {slots.map((n) => {
          const filled = n <= state.streak;
          return (
            <div
              key={n}
              title={`#${n}`}
              className="aspect-square rounded-sm"
              style={{
                background: filled
                  ? "linear-gradient(135deg, var(--accent-dim), var(--accent))"
                  : "rgba(255,255,255,0.06)",
              }}
            />
          );
        })}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Historial reciente</h2>
        {state.history.length === 0 && (
          <p className="text-sm text-[var(--muted)]">Aún no hay apuestas.</p>
        )}
        {state.history.slice(0, 24).map((h) => (
          <div key={h.id} className="glass rounded-2xl px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">
                {h.outcome.toUpperCase()}
                {h.matchLabel ? ` · ${h.matchLabel}` : ""}
              </p>
              <p className="font-[family-name:var(--font-mono)] text-xs text-[var(--muted)]">
                {h.hourKey}
              </p>
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {h.marketLabel ?? h.note ?? "—"}
              {h.score != null ? ` · score ${h.score.toFixed(1)}` : ""}
            </p>
          </div>
        ))}
      </section>

      {wins.length > 0 && (
        <p className="text-xs text-[var(--muted)]">
          Wins en racha actual (últimos): {wins.length}
        </p>
      )}
    </div>
  );
}
