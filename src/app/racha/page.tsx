"use client";

import { STREAK_GOAL, formatBetWhen } from "@/lib/engine";
import { useApp } from "@/lib/store";

export default function RachaPage() {
  const { state, ready } = useApp();
  if (!ready) return null;

  const slots = Array.from({ length: STREAK_GOAL }, (_, i) => i + 1);

  return (
    <div className="rise space-y-5">
      <header className="pt-3">
        <p className="section-label !normal-case !tracking-normal">Timeline</p>
        <h1 className="large-title">
          {state.streak}/{STREAK_GOAL}
        </h1>
        <p className="mt-1 text-[15px] text-[var(--muted)]">
          Mejor: {state.bestStreak}. Solo liquidaciones con marcador real.
        </p>
      </header>

      <div className="ios-card p-4">
        <div className="grid grid-cols-12 gap-1.5">
          {slots.map((n) => (
            <div
              key={n}
              title={`#${n}`}
              className="aspect-square rounded-[3px]"
              style={{
                background:
                  n <= state.streak ? "var(--ios-blue)" : "var(--ios-fill)",
              }}
            />
          ))}
        </div>
      </div>

      <p className="section-label">Historial</p>
      <div className="ios-inset divide-y divide-[var(--line)]">
        {state.history.length === 0 ? (
          <p className="p-4 text-[15px] text-[var(--muted)]">
            Sin apuestas aún.
          </p>
        ) : (
          state.history.slice(0, 30).map((h) => (
            <div key={h.id} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <span
                  className={`pill ${
                    h.outcome === "win"
                      ? "pill-win"
                      : h.outcome === "loss"
                        ? "pill-loss"
                        : "pill-skip"
                  }`}
                >
                  {h.outcome.toUpperCase()}
                </span>
                <span className="pill pill-auto">REAL</span>
                <p className="truncate text-[15px] font-medium">
                  {h.matchLabel ?? "—"}
                </p>
              </div>
              <p className="mt-1 text-[13px] text-[var(--muted)]">
                {h.marketLabel ?? h.note ?? ""}
                {h.score != null ? ` · ${h.score.toFixed(0)}` : ""}
              </p>
              <p className="mt-1 text-[12px] text-[var(--muted)]">
                {formatBetWhen(h.hourKey, h.at, state.settings.timezone)}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
