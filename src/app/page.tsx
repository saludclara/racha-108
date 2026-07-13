"use client";

import Link from "next/link";
import { Countdown, Money } from "@/components/Countdown";
import { STREAK_GOAL, formatBetWhen } from "@/lib/engine";
import { useApp } from "@/lib/store";

export default function HomePage() {
  const { state, ready, tiltActive, threshold } = useApp();

  if (!ready) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center text-[var(--muted)]">
        Cargando…
      </div>
    );
  }

  const progress = Math.min(100, (state.streak / STREAK_GOAL) * 100);
  const last = state.history[0];

  return (
    <div className="rise space-y-5 pb-4">
      <header className="pt-3">
        <p className="section-label !normal-case !tracking-normal">
          Automático · 11.11 AUD · 1/hora
        </p>
        <h1 className="large-title">
          Racha <span style={{ color: "var(--ios-blue)" }}>108</span>
        </h1>
      </header>

      <section className="ios-card p-5">
        <div className="flex items-center justify-between">
          <p className="text-[13px] text-[var(--muted)]">Próximo pick</p>
          <span className="pill pill-auto">Auto</span>
        </div>
        <Countdown />
        <p className="mt-2 text-[13px] text-[var(--muted)]">
          El motor apuesta solo, una vez por hora.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-[var(--ios-fill-2)] p-3">
            <p className="text-[12px] text-[var(--muted)]">HotStack</p>
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
              Tilt guard · umbral {threshold}
            </p>
          )}
        </div>
      </section>

      {last && (
        <section className="ios-card p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] text-[var(--muted)]">Última liquidación</p>
            <span className="pill pill-auto">SIM</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
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
            <p className="text-[15px] font-medium leading-snug">
              {last.matchLabel ?? last.note}
            </p>
          </div>
          <p className="mt-2 text-[13px] text-[var(--muted)]">
            {formatBetWhen(last.hourKey, last.at, state.settings.timezone)}
          </p>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            Partido ficticio generado por el motor — no es un fixture real.
          </p>
        </section>
      )}

      <Link href="/pick" className="btn btn-primary w-full">
        Ver pick de la hora
      </Link>
    </div>
  );
}
