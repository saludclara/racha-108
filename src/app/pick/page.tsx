"use client";

import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { Money } from "@/components/Countdown";
import { useApp } from "@/lib/store";

export default function PickPage() {
  const { state, ready, threshold, apiMessage, matchCount, refreshNow } =
    useApp();

  if (!ready) return null;

  const pick = state.currentPick;
  const last = state.history[0];
  const pending = state.pickStatus === "pending";
  const resolved = state.pickStatus === "resolved";
  const skipped = state.pickStatus === "skipped";

  return (
    <div className="rise space-y-5">
      <header className="pt-3">
        <div className="flex items-center gap-2">
          <p className="section-label !mb-0 !normal-case !tracking-normal">
            Pick real
          </p>
          <span className="pill pill-auto">REAL</span>
        </div>
        <h1 className="large-title mt-1">Apuesta del ciclo</h1>
        <p className="mt-1 text-[15px] text-[var(--muted)]">
          Solo partidos que puedan cerrar pronto (live / casi-FT). Si no hay,
          SKIP y HotStack libre · umbral {threshold} · {matchCount} en feed
        </p>
        {apiMessage && (
          <p className="mt-2 text-[13px]" style={{ color: "var(--ios-blue)" }}>
            {apiMessage}
          </p>
        )}
      </header>

      {skipped && (
        <div className="ios-card p-5">
          <span className="pill pill-skip">SIN PICK</span>
          <p className="mt-3 text-[15px] text-[var(--muted)]">
            {last?.note ?? apiMessage ?? "No hay mercado real elegible ahora."}
          </p>
          <button type="button" className="btn btn-primary mt-4 w-full" onClick={refreshNow}>
            Reconsultar feed
          </button>
        </div>
      )}

      {pick && (pending || resolved) && (
        <article className="ios-card p-5">
          {pending && (
            <div className="mb-4">
              <span
                className="pill"
                style={{
                  color: "var(--ios-orange)",
                  background: "rgba(255,149,0,0.14)",
                }}
              >
                Esperando resultado real
              </span>
            </div>
          )}
          {resolved && last && (
            <div className="mb-4">
              <span
                className={`pill ${
                  last.outcome === "win"
                    ? "pill-win"
                    : last.outcome === "loss"
                      ? "pill-loss"
                      : "pill-skip"
                }`}
              >
                {last.outcome === "win"
                  ? "Ganada (marcador real)"
                  : last.outcome === "push"
                    ? "Push"
                    : last.outcome === "loss"
                      ? "Perdida (marcador real)"
                      : last.outcome.toUpperCase()}
              </span>
            </div>
          )}

          <p className="text-[13px] text-[var(--muted)]">
            {pick.match.league} · {pick.match.status ?? "scheduled"}
          </p>
          <h2 className="mt-1 text-[22px] font-semibold tracking-tight leading-snug">
            {pick.match.home.name}{" "}
            <span className="text-[var(--muted)] font-normal">vs</span>{" "}
            {pick.match.away.name}
          </h2>
          {(pick.match.homeScore != null || pick.match.awayScore != null) && (
            <p className="mt-1 text-[20px] font-bold tabular-nums">
              {pick.match.homeScore ?? "-"} – {pick.match.awayScore ?? "-"}
            </p>
          )}
          <p
            className="mt-2 text-[17px] font-semibold"
            style={{ color: "var(--ios-blue)" }}
          >
            {pick.marketLabel}
          </p>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            Kickoff{" "}
            {new Date(
              pick.match.kickoffUtc ?? pick.match.kickoff,
            ).toLocaleString("es-AU", { timeZone: state.settings.timezone })}
          </p>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              ["Cuota", pick.odds.toFixed(2)],
              [
                "Stake",
                resolved && last?.stake != null
                  ? new Intl.NumberFormat("en-AU", {
                      style: "currency",
                      currency: "AUD",
                    }).format(last.stake)
                  : new Intl.NumberFormat("en-AU", {
                      style: "currency",
                      currency: "AUD",
                    }).format(state.hotStack),
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

          {resolved && last?.outcome === "win" && (
            <p className="mt-3 text-[14px] text-[var(--muted)]">
              Profit <Money amount={last.profit ?? 0} /> · Vault +
              <Money amount={last.vaultAdded ?? 0} />
            </p>
          )}

          <div className="mt-5 border-t border-[var(--line)] pt-4">
            <ScoreBreakdown total={pick.totalScore} layers={pick.layers} />
          </div>
        </article>
      )}

      <button type="button" className="btn btn-ghost w-full" onClick={refreshNow}>
        Actualizar feed
      </button>
    </div>
  );
}
