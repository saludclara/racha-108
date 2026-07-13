"use client";

import { Money } from "@/components/Countdown";
import { useApp } from "@/lib/store";

export default function VaultPage() {
  const { state, ready } = useApp();
  if (!ready) return null;

  return (
    <div className="rise space-y-5">
      <header className="pt-3">
        <p className="section-label !normal-case !tracking-normal">Seguro</p>
        <h1 className="large-title">Vault</h1>
        <p className="mt-1 text-[15px] text-[var(--muted)]">
          Nunca se apuesta. Crece con el split del profit.
        </p>
      </header>

      <div className="ios-card p-5">
        <p className="text-[13px] text-[var(--muted)]">Saldo</p>
        <p
          className="mt-1 text-[40px] font-bold tracking-tight vault-anim"
          style={{ color: "var(--vault)" }}
        >
          <Money amount={state.vault} />
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[12px] text-[var(--muted)]">
          <div className="rounded-xl bg-[var(--ios-fill-2)] p-3">
            ≤36
            <br />
            <span className="text-[15px] font-semibold text-[var(--ink)]">
              {(state.settings.vaultSplitEarly * 100).toFixed(0)}%
            </span>
          </div>
          <div className="rounded-xl bg-[var(--ios-fill-2)] p-3">
            ≤72
            <br />
            <span className="text-[15px] font-semibold text-[var(--ink)]">
              {(state.settings.vaultSplitMid * 100).toFixed(0)}%
            </span>
          </div>
          <div className="rounded-xl bg-[var(--ios-fill-2)] p-3">
            ≤108
            <br />
            <span className="text-[15px] font-semibold text-[var(--ink)]">
              {(state.settings.vaultSplitLate * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      </div>

      <p className="section-label">Depósitos</p>
      <div className="ios-inset divide-y divide-[var(--line)]">
        {state.vaultLedger.length === 0 && (
          <p className="p-4 text-[15px] text-[var(--muted)]">
            Todavía no hay depósitos.
          </p>
        )}
        {state.vaultLedger.map((d) => (
          <div key={d.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="font-semibold" style={{ color: "var(--vault)" }}>
                +<Money amount={d.amount} />
              </p>
              <p className="text-[13px] text-[var(--muted)]">
                Racha {d.streakAtDeposit} · {d.note}
              </p>
            </div>
            <p className="text-[11px] text-[var(--muted)]">
              {new Date(d.at).toLocaleString("es-AU")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
