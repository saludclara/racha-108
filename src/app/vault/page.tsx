"use client";

import { Money } from "@/components/Countdown";
import { useApp } from "@/lib/store";

export default function VaultPage() {
  const { state, ready } = useApp();
  if (!ready) return null;

  return (
    <div className="rise space-y-6">
      <header>
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.24em] text-[var(--vault)]">
          Seguro
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Vault</h1>
        <p className="mt-2 max-w-lg text-sm text-[var(--muted)]">
          Dinero apartado del HotStack. Nunca se apuesta. Crece con un % del
          profit tras cada win (más agresivo cuanto más larga la racha).
        </p>
      </header>

      <div className="glass rounded-3xl p-6">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--vault)]">
          Saldo vault
        </p>
        <p className="mt-2 text-4xl font-semibold text-[var(--vault)] vault-anim">
          <Money amount={state.vault} />
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-[var(--muted)]">
          <div className="rounded-xl border border-[var(--line)] p-3">
            Early ≤36
            <br />
            <span className="text-[var(--ink)]">
              {(state.settings.vaultSplitEarly * 100).toFixed(0)}%
            </span>
          </div>
          <div className="rounded-xl border border-[var(--line)] p-3">
            Mid ≤72
            <br />
            <span className="text-[var(--ink)]">
              {(state.settings.vaultSplitMid * 100).toFixed(0)}%
            </span>
          </div>
          <div className="rounded-xl border border-[var(--line)] p-3">
            Late ≤108
            <br />
            <span className="text-[var(--ink)]">
              {(state.settings.vaultSplitLate * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Depósitos</h2>
        {state.vaultLedger.length === 0 && (
          <p className="text-sm text-[var(--muted)]">
            Todavía no hay depósitos. Gana un pick para ver el split.
          </p>
        )}
        {state.vaultLedger.map((d) => (
          <div
            key={d.id}
            className="glass flex items-center justify-between rounded-2xl px-4 py-3"
          >
            <div>
              <p className="font-medium text-[var(--vault)]">
                +<Money amount={d.amount} />
              </p>
              <p className="text-xs text-[var(--muted)]">
                Racha {d.streakAtDeposit} · {d.note}
              </p>
            </div>
            <p className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--muted)]">
              {new Date(d.at).toLocaleString("es-AU")}
            </p>
          </div>
        ))}
      </section>
    </div>
  );
}
