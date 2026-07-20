"use client";

import Link from "next/link";
import { Countdown, Money } from "@/components/Countdown";
import { STREAK_GOAL, formatBetWhen } from "@/lib/engine";
import { useApp } from "@/lib/store";

export default function HomePage() {
  const {
    state,
    ready,
    tiltActive,
    threshold,
    apiMessage,
    matchCount,
    durableEnabled,
  } = useApp();

  if (!ready) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center text-[var(--muted)]">
        Cargando…
      </div>
    );
  }

  const progress = Math.min(100, (state.streak / STREAK_GOAL) * 100);
  const last = state.history[0];
  const pick = state.currentPick;
  const hotAtRisk = state.pickStatus === "pending" && Boolean(pick);

  return (
    <div className="rise space-y-5 pb-4">
      <header className="pt-3">
        <p className="section-label !normal-case !tracking-normal">
          Partidos reales · multi-fuente free · 11.11 AUD · cada 1h 11m 11s
        </p>
        <h1 className="large-title">
          Racha <span style={{ color: "var(--ios-blue)" }}>108</span>
        </h1>
      </header>

      <section className="ios-card p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] text-[var(--muted)]">Próxima decisión</p>
          <span className="flex items-center gap-1.5">
            <span
              className="pill"
              style={
                durableEnabled
                  ? { background: "rgba(52,199,89,.15)", color: "var(--ios-green)" }
                  : undefined
              }
            >
              {durableEnabled ? "Nube ON" : "Solo local"}
            </span>
            <span className="pill pill-auto">1h 11m 11s</span>
          </span>
        </div>
        <Countdown />
        <p className="mt-2 text-[13px] text-[var(--muted)]">
          Cada ciclo: SKIP o 1 pick BOOK con edge (sin finales live). Se
          liquida con marcador oficial; si el feed no cierra a tiempo, push y
          HotStack libre.
        </p>
        {apiMessage && (
          <p className="mt-2 text-[13px]" style={{ color: "var(--ios-blue)" }}>
            {apiMessage}
          </p>
        )}
        <p className="mt-1 text-[12px] text-[var(--muted)]">
          {matchCount} partidos en feed · preferencia {threshold}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-[var(--ios-fill-2)] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] text-[var(--muted)]">HotStack</p>
              <span
                className="pill"
                style={
                  hotAtRisk
                    ? {
                        color: "var(--ios-orange)",
                        background: "rgba(255,149,0,0.14)",
                      }
                    : {
                        color: "var(--ios-green)",
                        background: "rgba(52,199,89,0.14)",
                      }
                }
              >
                {hotAtRisk ? "a riesgo" : "libre"}
              </span>
            </div>
            <p className="mt-0.5 text-[22px] font-semibold tracking-tight">
              <Money amount={state.hotStack} />
            </p>
          </div>
          <div className="rounded-xl bg-[var(--ios-fill-2)] p-3">
            <p className="text-[12px] text-[var(--muted)]">Vault</p>
            <p
              className="mt-0.5 text-[22px] font-semibold tracking-tight vault-anim"
              style={{ color: "var(--vault)" }}
            >
              <Money amount={state.vault} />
            </p>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-[13px] text-[var(--muted)]">Racha</p>
            <p className="text-[20px] font-semibold tracking-tight">
              {state.streak}
              <span className="text-[var(--muted)]">/{STREAK_GOAL}</span>
            </p>
          </div>
          <div className="score-bar" style={{ height: 8 }}>
            <span style={{ width: `${progress}%` }} />
          </div>
          {tiltActive && (
            <p className="mt-3 text-[13px]" style={{ color: "var(--warn)" }}>
              Tilt guard · preferencia {threshold}
            </p>
          )}
        </div>
      </section>

      {pick && state.pickStatus === "pending" && (
        <Link
          href="/pick"
          className="ios-card block p-4 transition-opacity active:opacity-70"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] text-[var(--muted)]">Pick en curso</p>
            <span
              className="pill"
              style={{
                color: "var(--ios-orange)",
                background: "rgba(255,149,0,0.14)",
              }}
            >
              PENDING
            </span>
          </div>
          <p className="mt-2 text-[15px] font-medium">
            {pick.match.home.name} vs {pick.match.away.name}
          </p>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            {pick.marketLabel} · {pick.match.league}
          </p>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            Kickoff{" "}
            {new Date(pick.match.kickoffUtc ?? pick.match.kickoff).toLocaleString(
              "es-AU",
              { timeZone: state.settings.timezone },
            )}
          </p>
        </Link>
      )}

      {last && (
        <Link
          href="/racha"
          className="ios-card block p-4 transition-opacity active:opacity-70"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] text-[var(--muted)]">Pick anterior</p>
            <span
              className={`pill ${
                last.outcome === "win"
                  ? "pill-win"
                  : last.outcome === "loss"
                    ? "pill-loss"
                    : "pill-skip"
              }`}
            >
              {last.outcome.toUpperCase()}
            </span>
          </div>
          <p className="mt-2 text-[15px] font-medium leading-snug">
            {last.matchLabel ?? last.note ?? "—"}
          </p>
          {(last.marketLabel || last.odds != null) && (
            <p className="mt-1 text-[13px] text-[var(--muted)]">
              {[last.marketLabel, last.odds != null ? `@ ${last.odds}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            {formatBetWhen(last.hourKey, last.at, state.settings.timezone)}
          </p>
          {last.outcome === "loss" && last.plainFix ? (
            <p
              className="mt-2 text-[13px] leading-snug"
              style={{ color: "var(--ios-blue)" }}
            >
              {last.plainFix}
            </p>
          ) : null}
        </Link>
      )}

      <Link href="/pick" className="btn btn-primary w-full">
        Ver pick
      </Link>
    </div>
  );
}
