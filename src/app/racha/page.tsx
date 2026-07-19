"use client";

import { useEffect, useState } from "react";
import {
  STREAK_GOAL,
  computeMotorMetrics,
  formatBetWhen,
  type HistoryEntry,
} from "@/lib/engine";
import { useApp } from "@/lib/store";

const TIMELINE_FROM_KEY = "racha-108-timeline-from";

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

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

function cellColor(outcome: HistoryEntry["outcome"] | undefined): string {
  if (outcome === "win") return "var(--ios-blue)";
  if (outcome === "loss") return "var(--ios-red)";
  if (outcome === "pending") return "var(--ios-orange)";
  if (outcome === "push") return "var(--ios-teal)";
  if (outcome === "skip") return "rgba(120, 120, 128, 0.35)";
  return "var(--ios-fill)";
}

function cellTitle(entry: HistoryEntry | undefined, slot: number): string {
  if (!entry) return `Slot ${slot}`;
  const label = entry.matchLabel ?? entry.note ?? entry.hourKey;
  return `#${slot} · ${outcomeLabel(entry.outcome)} · ${label}`;
}

function buildRows(state: ReturnType<typeof useApp>["state"]): HistoryEntry[] {
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
      modelProb: pick.modelProb,
      edge: pick.edge,
      bookOdds: pick.bookOdds,
      oddsSource: pick.oddsSource,
      provider: pick.match.provider,
      league: pick.match.league,
      matchId: pick.match.id,
    });
  }
  return rows;
}

export default function RachaPage() {
  const { state, ready } = useApp();
  const [splitFromId, setSplitFromId] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    try {
      const saved = localStorage.getItem(TIMELINE_FROM_KEY);
      if (saved) {
        setSplitFromId(saved);
        return;
      }
      // Seed: partir desde el PUSH Chaves vs AVS (pedido del usuario)
      const chaves = state.history.find(
        (h) =>
          h.outcome === "push" &&
          /chaves\s+vs\s+avs/i.test(h.matchLabel ?? ""),
      );
      if (chaves) {
        localStorage.setItem(TIMELINE_FROM_KEY, chaves.id);
        setSplitFromId(chaves.id);
      }
    } catch {
      // ignore
    }
  }, [ready, state.history]);

  if (!ready) return null;

  const slots = Array.from({ length: STREAK_GOAL }, (_, i) => i + 1);
  const metrics = computeMotorMetrics(state.history, 50);
  const rows = buildRows(state);

  const chronological = [...rows]
    .filter((h) => h.outcome !== "skip")
    .reverse();

  const splitIdx = splitFromId
    ? chronological.findIndex((h) => h.id === splitFromId)
    : -1;
  const timeline = (
    splitIdx >= 0 ? chronological.slice(splitIdx) : chronological
  ).slice(0, STREAK_GOAL);

  const splitLabel =
    splitIdx >= 0
      ? chronological[splitIdx]?.matchLabel ??
        chronological[splitIdx]?.hourKey ??
        null
      : null;

  const setSplit = (id: string | null) => {
    setSplitFromId(id);
    try {
      if (id) localStorage.setItem(TIMELINE_FROM_KEY, id);
      else localStorage.removeItem(TIMELINE_FROM_KEY);
    } catch {
      // ignore
    }
  };

  return (
    <div className="rise space-y-5">
      <header className="pt-3">
        <p className="section-label !normal-case !tracking-normal">Timeline</p>
        <h1 className="large-title">
          {state.streak}/{STREAK_GOAL}
        </h1>
        <p className="mt-1 text-[15px] text-[var(--muted)]">
          Mejor: {state.bestStreak}. Camino real del historial, no solo wins.
        </p>
      </header>

      <div className="ios-card p-4">
        <div className="grid grid-cols-12 gap-1.5">
          {slots.map((n, i) => {
            const entry = timeline[i];
            const isSplit = entry != null && entry.id === splitFromId;
            return (
              <button
                key={entry?.id ?? `slot-${n}`}
                type="button"
                title={
                  entry
                    ? `${cellTitle(entry, n)} · tocá para partir desde acá`
                    : cellTitle(entry, n)
                }
                disabled={!entry}
                onClick={() => entry && setSplit(entry.id)}
                className="aspect-square rounded-[3px] disabled:cursor-default"
                style={{
                  background: cellColor(entry?.outcome),
                  outline: isSplit
                    ? "2px solid var(--ios-label)"
                    : undefined,
                  outlineOffset: isSplit ? 1 : undefined,
                }}
              />
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--muted)]">
          <span>
            <span
              className="mr-1 inline-block h-2 w-2 rounded-[2px]"
              style={{ background: "var(--ios-blue)" }}
            />
            Win
          </span>
          <span>
            <span
              className="mr-1 inline-block h-2 w-2 rounded-[2px]"
              style={{ background: "var(--ios-red)" }}
            />
            Loss
          </span>
          <span>
            <span
              className="mr-1 inline-block h-2 w-2 rounded-[2px]"
              style={{ background: "var(--ios-orange)" }}
            />
            En juego
          </span>
          <span>
            <span
              className="mr-1 inline-block h-2 w-2 rounded-[2px]"
              style={{ background: "var(--ios-teal)" }}
            />
            Push
          </span>
          {splitLabel && (
            <button
              type="button"
              onClick={() => setSplit(null)}
              className="ml-auto text-[var(--ios-blue)]"
            >
              Desde {splitLabel.split(" vs ")[0] ?? "corte"} · ver todo
            </button>
          )}
        </div>
      </div>

      <div className="ios-card p-4">
        <p className="text-[13px] text-[var(--muted)]">Hit-rate (últimos 50)</p>
        <p
          className="text-[28px] font-bold tracking-tight"
          style={{ color: "var(--ios-blue)" }}
        >
          {pct(metrics.hitRate)}
        </p>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          {metrics.wins}W / {metrics.losses}L · {metrics.skips} SKIP
          {metrics.avgEdge != null
            ? ` · edge ${(metrics.avgEdge * 100).toFixed(1)}pp`
            : ""}
        </p>
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
                <span className="pill pill-auto">
                  {h.oddsSource === "book" ? "BOOK" : "REAL"}
                </span>
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
                {h.modelProb != null
                  ? ` · p ${(h.modelProb * 100).toFixed(0)}%`
                  : ""}
                {h.oddsSource === "book" && h.edge != null
                  ? ` · edge ${(h.edge * 100).toFixed(1)}pp`
                  : ""}
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
