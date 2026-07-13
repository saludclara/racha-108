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
        <p className="text-[13px] text-[var(--muted)]">Score motor</p>
        <p className="text-[28px] font-bold tracking-tight" style={{ color: "var(--ios-blue)" }}>
          {total.toFixed(1)}
        </p>
      </div>
      {layers.map((l) => (
        <div key={l.key} className="space-y-1">
          <div className="flex justify-between text-[13px]">
            <span>
              {l.label}{" "}
              <span className="text-[var(--muted)]">
                ({Math.round(l.weight * 100)}%)
              </span>
            </span>
            <span className="tabular-nums font-semibold">{l.score.toFixed(0)}</span>
          </div>
          <div className="score-bar">
            <span style={{ width: `${l.score}%` }} />
          </div>
          <p className="text-[12px] text-[var(--muted)]">{l.note}</p>
        </div>
      ))}
    </div>
  );
}
