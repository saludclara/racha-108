"use client";

import { useApp } from "@/lib/store";

export default function SettingsPage() {
  const { state, ready, updateSettings, resetAll, refreshNow } = useApp();
  if (!ready) return null;

  const s = state.settings;

  return (
    <div className="rise space-y-5">
      <header className="pt-3">
        <p className="section-label !normal-case !tracking-normal">Config</p>
        <h1 className="large-title">Ajustes</h1>
        <p className="mt-1 text-[15px] text-[var(--muted)]">
          Fuente: ESPN scoreboards (partidos reales). Sin simulación.
        </p>
      </header>

      <div className="ios-inset divide-y divide-[var(--line)]">
        <label className="block px-4 py-3">
          <span className="text-[13px] text-[var(--muted)]">Timezone</span>
          <select
            className="mt-1 w-full appearance-none bg-transparent text-[17px] outline-none"
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

        <label className="block px-4 py-3">
          <span className="flex justify-between text-[15px]">
            Umbral score
            <span className="text-[var(--muted)]">{s.scoreThreshold}</span>
          </span>
          <input
            type="range"
            min={70}
            max={95}
            value={s.scoreThreshold}
            className="mt-3 w-full accent-[var(--ios-blue)]"
            onChange={(e) =>
              updateSettings({ scoreThreshold: Number(e.target.value) })
            }
          />
        </label>

        {(
          [
            ["vaultSplitEarly", "Split early ≤36", s.vaultSplitEarly],
            ["vaultSplitMid", "Split mid ≤72", s.vaultSplitMid],
            ["vaultSplitLate", "Split late ≤108", s.vaultSplitLate],
          ] as const
        ).map(([key, label, value]) => (
          <label key={key} className="block px-4 py-3">
            <span className="flex justify-between text-[15px]">
              {label}
              <span className="text-[var(--muted)]">
                {Math.round(value * 100)}%
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={90}
              value={Math.round(value * 100)}
              className="mt-3 w-full accent-[var(--ios-blue)]"
              onChange={(e) =>
                updateSettings({ [key]: Number(e.target.value) / 100 })
              }
            />
          </label>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <button type="button" className="btn btn-ghost" onClick={refreshNow}>
          Reconsultar partidos reales
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ color: "var(--ios-red)" }}
          onClick={() => {
            if (confirm("¿Resetear toda la simulación de bankroll?")) resetAll();
          }}
        >
          Reset bankroll
        </button>
      </div>
    </div>
  );
}
