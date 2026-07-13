"use client";

import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { Money } from "@/components/Countdown";
import { useApp } from "@/lib/store";

export default function PickPage() {
  const { state, ready, threshold, runNextHour } = useApp();

  if (!ready) return null;

  const pick = state.currentPick;
  const last = state.history[0];
  const showPick = Boolean(pick) && state.pickStatus !== "skipped";

  return (
    <div className="rise space-y-5">
      <header className="pt-3">
        <div className="flex items-center gap-2">
          <p className="section-label !mb-0 !normal-case !tracking-normal">
            Pick automático
          </p>
          <span className="pill pill-auto">1 / hora</span>
        </div>
        <h1 className="large-title mt-1">Apuesta de la hora</h1>
        <p className="mt-1 text-[15px] text-[var(--muted)]">
          Seleccionada y liquidada sola · umbral {threshold}
        </p>
      </header>

      {!showPick && (
        <div className="ios-card p-5">
          <p className="text-[15px] text-[var(--muted)]">
            Preparando pick automático…
          </p>
          <button
            type="button"
            className="btn btn-primary mt-4 w-full"
            onClick={runNextHour}
          >
            Generar pick ahora
          </button>
        </div>
      )}

      {showPick && pick && (
        <article className="ios-card p-5">
          {last && state.pickStatus === "resolved" && (
            <div className="mb-4">
              <span
                className={`pill ${
                  last.outcome === "win" ? "pill-win" : "pill-loss"
                }`}
              >
                {last.outcome === "win" ? "Ganada automáticamente" : "Perdida"}
              </span>
            </div>
          )}

          <p className="text-[13px] text-[var(--muted)]">
            {pick.match.league} · jornada {pick.match.matchday} ·{" "}
            <span className="font-semibold" style={{ color: "var(--ios-blue)" }}>
              SIM
            </span>
          </p>
          <h2 className="mt-1 text-[22px] font-semibold tracking-tight leading-snug">
            {pick.match.home.name}{" "}
            <span className="text-[var(--muted)] font-normal">vs</span>{" "}
            {pick.match.away.name}
          </h2>
          <p
            className="mt-2 text-[17px] font-semibold"
            style={{ color: "var(--ios-blue)" }}
          >
            {pick.marketLabel}
          </p>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              ["Cuota", pick.odds.toFixed(2)],
              [
                "Stake",
                last?.stake != null
                  ? new Intl.NumberFormat("en-AU", {
                      style: "currency",
                      currency: "AUD",
                    }).format(last.stake)
                  : "—",
              ],
              ["Confianza", `${(pick.modelProb * 100).toFixed(1)}%`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-[var(--ios-fill-2)] p-3">
                <p className="text-[11px] text-[var(--muted)]">{k}</p>
                <p className="mt-0.5 text-[16px] font-semibold tracking-tight">
                  {v}
                </p>
              </div>
            ))}
          </div>

          {last?.outcome === "win" && (
            <p className="mt-3 text-[14px] text-[var(--muted)]">
              Profit <Money amount={last.profit ?? 0} /> · Vault +
              <Money amount={last.vaultAdded ?? 0} />
            </p>
          )}
          {last?.outcome === "loss" && last.note && (
            <p className="mt-3 text-[14px]" style={{ color: "var(--danger)" }}>
              {last.note}
            </p>
          )}

          <div className="mt-5 border-t border-[var(--line)] pt-4">
            <ScoreBreakdown total={pick.totalScore} layers={pick.layers} />
          </div>
        </article>
      )}

      <button type="button" className="btn btn-primary w-full" onClick={runNextHour}>
        Simular siguiente hora
      </button>
      <p className="text-center text-[12px] text-[var(--muted)]">
        En producción el pick corre solo al cambiar la hora.
      </p>
    </div>
  );
}
