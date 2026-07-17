"use client";

import { STREAK_GOAL, formatBetWhen, type HistoryEntry } from "@/lib/engine";
import { useApp } from "@/lib/store";

function outcomePill(outcome: HistoryEntry["outcome"]): string {
  if (outcome === "win") return "pill-win";
  if (outcome === "loss") return "pill-loss";
  if (outcome === "pending") return "pill-auto";
  return "pill-skip";
}

function outcomeLabel(outcome: HistoryEntry["outcome"]): string {
  if (outcome === "pending") return "EN JUEGO";
  if (outcome === "push") return "PUSH";
  return outcome.toUpperCase();
}

export default function RachaPage() {
  const { state, ready } = useApp();
  if (!ready) return null;

  const slots = Array.from({ length: STREAK_GOAL }, (_, i) => i + 1);

  // Backfill: open pick must appear even if an older client never wrote pending
  const rows: HistoryEntry[] = [...state.history];
  if (
    state.pickStatus === "pending" &&
    state.currentPick &&
    !rows.some(
      (h) =>
        h.hourKey === (state.currentHourKey ?? state.currentPick!.hourKey) &&
        h.outcome === "pending",
    )
  ) {
    const pick = state.currentPick;
    rows.unshift({
      id: `pending-${pick.hourKey}`,
      hourKey: pick.hourKey,
      at: new Date().toISOString(),
      outcome: "pending",
      stake: state.hotStack,
      odds: pick.odds,
      marketLabel: pick.marketLabel,
      matchLabel: `${pick.match.home.name} vs ${pick.match.away.name}`,
      score: pick.totalScore,
      note: "En juego · HotStack a riesgo",
    });
  }

  return (
    <div className="rise space-y-5">
      <header className="pt-3">
        <p className="section-label !normal-case !tracking-normal">Timeline</p>
        <h1 className="large-title">
          {state.streak}/{STREAK_GOAL}
        </h1>
        <p className="mt-1 text-[15px] text-[var(--muted)]">
          Mejor: {state.bestStreak}. Picks en juego + liquidaciones reales.
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
        {rows.length === 0 ? (
          <p className="p-4 text-[15px] text-[var(--muted)]">
            Sin apuestas aún. El próximo ciclo va a aparecer acá.
          </p>
        ) : (
          rows.slice(0, 40).map((h) => (
            <div key={h.id} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <span className={`pill ${outcomePill(h.outcome)}`}>
                  {outcomeLabel(h.outcome)}
                </span>
                <span className="pill pill-auto">REAL</span>
                <p className="truncate text-[15px] font-medium">
                  {h.matchLabel ?? h.note ?? "—"}
                </p>
              </div>
              <p className="mt-1 text-[13px] text-[var(--muted)]">
                {h.marketLabel ||
                  (h.outcome === "skip" || h.outcome === "pending"
                    ? h.note
                    : "") ||
                  ""}
                {h.score != null ? ` · score ${h.score.toFixed(0)}` : ""}
                {h.odds != null ? ` · @${h.odds.toFixed(2)}` : ""}
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
