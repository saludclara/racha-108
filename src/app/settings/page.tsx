"use client";

import { useApp } from "@/lib/store";

export default function SettingsPage() {
  const {
    state,
    ready,
    shareUrl,
    durableEnabled,
    updateSettings,
    resetAll,
    refreshNow,
    sources,
    matchCount,
  } = useApp();
  if (!ready) return null;

  const s = state.settings;
  const activeSources = sources.filter((x) => x.enabled && x.ok && x.count > 0);
  const missingKeys = sources.filter((x) => x.enabled && !x.configured);

  return (
    <div className="rise space-y-5">
      <header className="pt-3">
        <p className="section-label !normal-case !tracking-normal">Config</p>
        <h1 className="large-title">Ajustes</h1>
        <p className="mt-1 text-[15px] text-[var(--muted)]">
          Feed multi-fuente free · {matchCount} fixtures en ventana.
          {activeSources.length
            ? ` Activas: ${activeSources.map((x) => x.label).join(", ")}.`
            : " ESPN siempre disponible."}
        </p>
      </header>

      <div className="ios-inset divide-y divide-[var(--line)]">
        <div className="px-4 py-3">
          <p className="text-[13px] text-[var(--muted)]">Nube automática</p>
          {durableEnabled && shareUrl ? (
            <>
              <p className="mt-1 text-[15px]" style={{ color: "var(--ios-green)" }}>
                Activa · picks aunque cierres la app
              </p>
              <p className="mt-2 text-[13px] text-[var(--muted)]">
                Tu racha se guarda sola en la nube. El cron avanza cada ~15 min
                sin que copies nada. El link de abajo es solo backup / para
                compartir.
              </p>
              <p className="mt-3 break-all text-[13px] leading-snug text-[var(--muted)]">
                {shareUrl}
              </p>
              <button
                type="button"
                className="btn btn-ghost mt-3 w-full"
                onClick={() => {
                  void navigator.clipboard.writeText(shareUrl);
                }}
              >
                Copiar link de backup
              </button>
            </>
          ) : (
            <p className="mt-1 text-[15px] text-[var(--muted)]">
              Conectando a la nube… Si no prende, revisá Supabase en el
              servidor. Sin nube, al cerrar la app se pausan los picks.
            </p>
          )}
        </div>
      </div>

      <div className="ios-inset divide-y divide-[var(--line)]">
        <div className="px-4 py-3">
          <p className="text-[13px] text-[var(--muted)]">Fuentes free</p>
          <p className="mt-1 text-[15px]">
            ESPN siempre ON · sin API key
          </p>
        </div>

        {(
          [
            [
              "enableApiFootball",
              "API-Football",
              "100 req/día · más ligas + scores",
              s.enableApiFootball,
            ],
            [
              "enableOddsApi",
              "The Odds API",
              "Cuotas bookmaker reales (h2h / totals)",
              s.enableOddsApi,
            ],
            [
              "enableEsports",
              "PandaScore esports",
              "LoL / CS2 / Dota / Valorant fixtures",
              s.enableEsports,
            ],
          ] as const
        ).map(([key, title, hint, value]) => (
          <label
            key={key}
            className="flex items-center justify-between gap-3 px-4 py-3"
          >
            <span>
              <span className="block text-[15px]">{title}</span>
              <span className="mt-0.5 block text-[13px] text-[var(--muted)]">
                {hint}
              </span>
            </span>
            <input
              type="checkbox"
              className="h-5 w-5 accent-[var(--ios-blue)]"
              checked={value}
              onChange={(e) => updateSettings({ [key]: e.target.checked })}
            />
          </label>
        ))}

        {sources.length > 0 && (
          <div className="space-y-2 px-4 py-3">
            <p className="text-[13px] text-[var(--muted)]">Estado del feed</p>
            {sources.map((src) => (
              <div
                key={src.id}
                className="flex items-baseline justify-between gap-2 text-[14px]"
              >
                <span>
                  {src.label}
                  {!src.configured && src.enabled ? (
                    <span className="text-[var(--muted)]"> · sin key</span>
                  ) : null}
                  {src.error ? (
                    <span style={{ color: "var(--ios-orange)" }}>
                      {" "}
                      · {src.error}
                    </span>
                  ) : null}
                </span>
                <span
                  style={{
                    color: !src.enabled
                      ? "var(--muted)"
                      : src.ok
                        ? "var(--ios-green)"
                        : "var(--ios-orange)",
                  }}
                >
                  {!src.enabled
                    ? "OFF"
                    : src.ok
                      ? `${src.count}`
                      : "error"}
                </span>
              </div>
            ))}
          </div>
        )}

        {missingKeys.length > 0 && (
          <p className="px-4 py-3 text-[13px] text-[var(--muted)]">
            Keys opcionales en Vercel / `.env.local`:{" "}
            <code className="text-[12px]">API_FOOTBALL_KEY</code>,{" "}
            <code className="text-[12px]">ODDS_API_KEY</code>,{" "}
            <code className="text-[12px]">PANDASCORE_TOKEN</code>
          </p>
        )}
      </div>

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
            Preferencia de score
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
          <span className="mt-2 block text-[13px] text-[var(--muted)]">
            Prioriza picks ≥ este score. Si no hay ninguno, el ciclo igual elige
            el mejor disponible (nunca se inventan partidos).
          </span>
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
