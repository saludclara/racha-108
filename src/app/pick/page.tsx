"use client";

import { useState } from "react";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { Money } from "@/components/Countdown";
import { useApp } from "@/lib/store";

export default function PickPage() {
  const {
    state,
    ready,
    threshold,
    placeAndResolve,
    skipHour,
    forceNewHour,
  } = useApp();
  const [pulse, setPulse] = useState(false);

  if (!ready) return null;

  const pick = state.currentPick;
  const resolved =
    state.pickStatus === "resolved" || state.pickStatus === "skipped";
  const last = state.history[0];

  const onConfirm = () => {
    setPulse(true);
    placeAndResolve();
    setTimeout(() => setPulse(false), 900);
  };

  return (
    <div className="rise space-y-6">
      <header>
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
          Pick · umbral {threshold}
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Apuesta de la hora</h1>
      </header>

      {state.pickStatus === "skipped" && (
        <div className="glass rounded-2xl p-5 text-[var(--warn)]">
          <p className="font-semibold">SKIP</p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {last?.note ?? "Sin pick válido esta hora."}
          </p>
          <button type="button" className="btn btn-ghost mt-4" onClick={forceNewHour}>
            Simular siguiente hora
          </button>
        </div>
      )}

      {pick && state.pickStatus !== "skipped" && (
        <article className={`glass rounded-3xl p-5 md:p-6 ${pulse ? "pulse-once" : ""}`}>
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
            {pick.match.league} · jornada {pick.match.matchday}
          </p>
          <h2 className="mt-2 text-2xl font-semibold leading-tight">
            {pick.match.home.name}{" "}
            <span className="text-[var(--muted)]">vs</span>{" "}
            {pick.match.away.name}
          </h2>
          <p className="mt-3 text-lg text-[var(--accent)]">{pick.marketLabel}</p>

          <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-[var(--muted)]">Cuota</p>
              <p className="text-xl font-semibold">{pick.odds.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-[var(--muted)]">Stake</p>
              <p className="text-xl font-semibold">
                <Money amount={state.hotStack} />
              </p>
            </div>
            <div>
              <p className="text-[var(--muted)]">p modelo</p>
              <p className="text-xl font-semibold">
                {(pick.modelProb * 100).toFixed(1)}%
              </p>
            </div>
          </div>

          <div className="mt-6 border-t border-[var(--line)] pt-5">
            <ScoreBreakdown total={pick.totalScore} layers={pick.layers} />
          </div>

          {!resolved && (
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                className="btn btn-primary flex-1"
                onClick={onConfirm}
                disabled={state.goalReached}
              >
                Confirmar apuesta ficticia
              </button>
              <button type="button" className="btn btn-ghost flex-1" onClick={skipHour}>
                Skip manual
              </button>
            </div>
          )}

          {state.pickStatus === "resolved" && last && (
            <div className="mt-6 rounded-2xl border border-[var(--line)] p-4">
              <p
                className={`text-lg font-semibold ${
                  last.outcome === "win"
                    ? "text-[var(--accent)]"
                    : "text-[var(--danger)]"
                }`}
              >
                {last.outcome === "win" ? "GANADA" : "PERDIDA"}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {last.outcome === "win"
                  ? `Profit ${last.profit?.toFixed(2)} · Vault +${last.vaultAdded?.toFixed(2)}`
                  : last.note}
              </p>
              <button
                type="button"
                className="btn btn-ghost mt-4 w-full"
                onClick={forceNewHour}
              >
                Simular siguiente hora
              </button>
            </div>
          )}
        </article>
      )}

      {!pick && state.pickStatus !== "skipped" && (
        <p className="text-[var(--muted)]">Preparando pick…</p>
      )}
    </div>
  );
}
