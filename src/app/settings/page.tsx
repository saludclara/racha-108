"use client";

import { useApp } from "@/lib/store";

export default function SettingsPage() {
  const { state, ready, updateSettings, resetAll, forceNewHour } = useApp();
  if (!ready) return null;

  const s = state.settings;

  return (
    <div className="rise space-y-6">
      <header>
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
          Config
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Ajustes</h1>
      </header>

      <label className="glass block rounded-2xl p-4">
        <span className="text-sm text-[var(--muted)]">Timezone</span>
        <select
          className="mt-2 w-full rounded-xl border border-[var(--line)] bg-transparent px-3 py-3"
          value={s.timezone}
          onChange={(e) => updateSettings({ timezone: e.target.value })}
        >
          <option value="Australia/Sydney">Australia/Sydney</option>
          <option value="Australia/Melbourne">Australia/Melbourne</option>
          <option value="Pacific/Auckland">Pacific/Auckland</option>
          <option value="UTC">UTC</option>
          <option value="America/Mexico_City">America/Mexico_City</option>
          <option value="Europe/Madrid">Europe/Madrid</option>
        </select>
      </label>

      <label className="glass block rounded-2xl p-4">
        <span className="flex justify-between text-sm text-[var(--muted)]">
          Umbral mínimo de score
          <span className="text-[var(--ink)]">{s.scoreThreshold}</span>
        </span>
        <input
          type="range"
          min={70}
          max={95}
          value={s.scoreThreshold}
          className="mt-3 w-full"
          onChange={(e) =>
            updateSettings({ scoreThreshold: Number(e.target.value) })
          }
        />
      </label>

      {(
        [
          ["vaultSplitEarly", "Split Vault early (≤36)", s.vaultSplitEarly],
          ["vaultSplitMid", "Split Vault mid (≤72)", s.vaultSplitMid],
          ["vaultSplitLate", "Split Vault late (≤108)", s.vaultSplitLate],
        ] as const
      ).map(([key, label, value]) => (
        <label key={key} className="glass block rounded-2xl p-4">
          <span className="flex justify-between text-sm text-[var(--muted)]">
            {label}
            <span className="text-[var(--ink)]">{Math.round(value * 100)}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={90}
            value={Math.round(value * 100)}
            className="mt-3 w-full"
            onChange={(e) =>
              updateSettings({ [key]: Number(e.target.value) / 100 })
            }
          />
        </label>
      ))}

      <div className="flex flex-col gap-3 pt-2">
        <button type="button" className="btn btn-ghost" onClick={forceNewHour}>
          Demo: siguiente hora
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
          onClick={() => {
            if (confirm("¿Resetear toda la simulación?")) resetAll();
          }}
        >
          Reset total
        </button>
      </div>

      <p className="text-xs text-[var(--muted)]">
        Todo es ficticio. Estado guardado en este dispositivo (localStorage).
      </p>
    </div>
  );
}
