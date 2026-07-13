"use client";

import type { LayerScore } from "@/lib/engine";

export function ScoreBreakdown({
  total,
  layers,
}: {
  total: number;
  layers: LayerScore[];
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between">
        <p className="text-sm uppercase tracking-[0.18em] text-[var(--muted)]">
          Score motor
        </p>
        <p className="text-3xl font-semibold text-[var(--accent)]">
          {total.toFixed(1)}
        </p>
      </div>
      {layers.map((l) => (
        <div key={l.key} className="space-y-1">
          <div className="flex justify-between text-sm">
            <span>
              {l.label}{" "}
              <span className="text-[var(--muted)]">
                ({Math.round(l.weight * 100)}%)
              </span>
            </span>
            <span className="font-[family-name:var(--font-mono)]">
              {l.score.toFixed(0)}
            </span>
          </div>
          <div className="score-bar">
            <span style={{ width: `${l.score}%` }} />
          </div>
          <p className="text-xs text-[var(--muted)]">{l.note}</p>
        </div>
      ))}
    </div>
  );
}
