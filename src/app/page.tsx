"use client";

import Link from "next/link";
import { Countdown, Money } from "@/components/Countdown";
import { STREAK_GOAL } from "@/lib/engine";
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

  return (
    <div className="rise flex min-h-[calc(100dvh-7rem)] flex-col justify-between gap-8">
      <header className="space-y-3 pt-2">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.28em] text-[var(--muted)]">
          simulación · aud · 11.11
        </p>
        <h1 className="text-5xl font-semibold leading-none tracking-tight md:text-6xl">
          Racha{" "}
          <span className="text-[var(--accent)]">108</span>
        </h1>
        <p className="max-w-md text-base text-[var(--muted)] md:text-lg">
          Una apuesta ficticia por hora. Bajo riesgo. Compound en HotStack,
          cash seguro en Vault.
        </p>
      </header>

      <section className="glass rounded-3xl p-5 md:p-7">
        <p className="mb-2 text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
          Próxima hora
        </p>
        <Countdown />
        <div className="mt-6 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
              HotStack
            </p>
            <p className="mt-1 text-2xl font-semibold">
              <Money amount={state.hotStack} />
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--vault)]">
              Vault
            </p>
            <p className="mt-1 text-2xl font-semibold text-[var(--vault)] vault-anim">
              <Money amount={state.vault} />
            </p>
          </div>
        </div>

        <div className="mt-6">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-sm text-[var(--muted)]">Racha</p>
            <p className="text-xl font-semibold">
              {state.streak}
              <span className="text-[var(--muted)]">/{STREAK_GOAL}</span>
            </p>
          </div>
          <div className="score-bar" style={{ height: 8 }}>
            <span style={{ width: `${progress}%` }} />
          </div>
          {tiltActive && (
            <p className="mt-3 text-sm text-[var(--warn)]">
              Tilt guard activo — umbral {threshold}
            </p>
          )}
          {state.goalReached && (
            <p className="mt-3 text-sm text-[var(--accent)]">
              Objetivo 108 alcanzado. El Vault queda como premio seguro.
            </p>
          )}
        </div>
      </section>

      <div className="flex flex-col gap-3 pb-2 sm:flex-row">
        <Link href="/pick" className="btn btn-primary flex-1 pulse-once">
          Ver pick de la hora
        </Link>
        <Link href="/vault" className="btn btn-ghost flex-1">
          Abrir Vault
        </Link>
      </div>
    </div>
  );
}
