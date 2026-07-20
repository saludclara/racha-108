"use client";

import { useId, useState, type ReactNode } from "react";
import { useApp } from "@/lib/store";

/** Tiny “i” that opens a mega-simple tip with an example. */
function InfoTip({ tip, example }: { tip: string; example: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="ml-1.5 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold leading-none"
        style={{
          color: "var(--ios-blue)",
          background: "rgba(0,122,255,0.12)",
        }}
        title="¿Qué es esto?"
      >
        i
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className="absolute left-0 top-[calc(100%+6px)] z-20 w-[min(280px,calc(100vw-48px))] rounded-xl p-3 text-[13px] leading-snug shadow-lg"
          style={{
            background: "var(--card)",
            border: "0.5px solid var(--line)",
            color: "var(--ink)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="block text-[var(--muted)]">{tip}</span>
          <span className="mt-1.5 block font-medium">
            Ej: {example}
          </span>
          <button
            type="button"
            className="mt-2 text-[12px] font-semibold"
            style={{ color: "var(--ios-blue)" }}
            onClick={() => setOpen(false)}
          >
            Listo
          </button>
        </span>
      )}
    </span>
  );
}

function LabelWithInfo({
  children,
  tip,
  example,
  trailing,
}: {
  children: ReactNode;
  tip: string;
  example: string;
  trailing?: ReactNode;
}) {
  return (
    <span className="flex items-center justify-between gap-2 text-[15px]">
      <span className="flex min-w-0 items-center">
        <span className="truncate">{children}</span>
        <InfoTip tip={tip} example={example} />
      </span>
      {trailing}
    </span>
  );
}

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
  const missingKeys = sources.filter((x) => x.enabled && !x.configured);

  return (
    <div className="rise space-y-5">
      <header className="pt-3">
        <p className="section-label !normal-case !tracking-normal">Config</p>
        <h1 className="large-title">Ajustes</h1>
        <p className="mt-1 text-[15px] text-[var(--muted)]">
          Acá elegís de dónde salen los partidos y cómo se parte la plata
          cuando ganás. Ahora hay {matchCount} partidos a la vista.
        </p>
      </header>

      <div className="ios-inset divide-y divide-[var(--line)]">
        <div className="px-4 py-3">
          <LabelWithInfo
            tip="Si está prendida, la app sigue eligiendo y liquidando picks aunque cierres el celu."
            example="Cerrás Safari a las 2am · a las 3am igual se juega el ciclo."
          >
            Guardado en la nube
          </LabelWithInfo>
          {durableEnabled && shareUrl ? (
            <>
              <p
                className="mt-2 text-[15px]"
                style={{ color: "var(--ios-green)" }}
              >
                Prendida · sigue sola
              </p>
              <p className="mt-2 text-[13px] text-[var(--muted)]">
                Tu racha se guarda sola. El link de abajo es solo por si
                querés abrirlo en otra pantalla.
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
                Copiar link de respaldo
              </button>
            </>
          ) : (
            <p className="mt-2 text-[15px] text-[var(--muted)]">
              Todavía conectando… Sin nube, al cerrar la app se pausa.
            </p>
          )}
        </div>
      </div>

      <div className="ios-inset divide-y divide-[var(--line)]">
        <div className="px-4 py-3">
          <LabelWithInfo
            tip="Son los sitios de donde sacamos partidos y cuotas. ESPN viene siempre."
            example="Sin Odds API casi no hay apuesta: el motor pide cuota de casa real."
          >
            De dónde sacamos datos
          </LabelWithInfo>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            ESPN siempre prendido · no pide clave
          </p>
        </div>

        {(
          [
            [
              "enableApiFootball",
              "Más ligas (API-Football)",
              "Suma más partidos y marcadores. Tiene tope free por día.",
              "Enciende ligas chicas que ESPN a veces no trae.",
              s.enableApiFootball,
            ],
            [
              "enableOddsApi",
              "Cuotas de casa (Odds API)",
              "Sin esto casi siempre hay SKIP: el motor no apuesta sin cuota real.",
              "Ve Under 3.5 a @1.45 en una bookie y recién ahí puede jugar.",
              s.enableOddsApi,
            ],
            [
              "enableEsports",
              "Esports (PandaScore)",
              "Partidos de LoL, CS, Dota y Valorant.",
              "Hay un LoL a las 18h · puede entrar al ciclo si hay cuota.",
              s.enableEsports,
            ],
          ] as const
        ).map(([key, title, tip, example, value]) => (
          <label
            key={key}
            className="flex items-center justify-between gap-3 px-4 py-3"
          >
            <span className="min-w-0">
              <LabelWithInfo tip={tip} example={example}>
                {title}
              </LabelWithInfo>
            </span>
            <input
              type="checkbox"
              className="h-5 w-5 shrink-0 accent-[var(--ios-blue)]"
              checked={value}
              onChange={(e) => updateSettings({ [key]: e.target.checked })}
            />
          </label>
        ))}

        {sources.length > 0 && (
          <div className="space-y-2 px-4 py-3">
            <LabelWithInfo
              tip="Cuántos partidos trajo cada fuente ahora. Si dice “sin key”, falta la clave."
              example="Odds API · sin key → no hay cuotas → SKIP."
            >
              ¿Están andando?
            </LabelWithInfo>
            {sources.map((src) => (
              <div
                key={src.id}
                className="flex items-baseline justify-between gap-2 text-[14px]"
              >
                <span>
                  {src.label}
                  {!src.configured && src.enabled ? (
                    <span className="text-[var(--muted)]"> · falta clave</span>
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
            Claves opcionales en el servidor:{" "}
            <code className="text-[12px]">API_FOOTBALL_KEY</code>,{" "}
            <code className="text-[12px]">ODDS_API_KEY</code>,{" "}
            <code className="text-[12px]">PANDASCORE_TOKEN</code>
          </p>
        )}
      </div>

      <div className="ios-inset divide-y divide-[var(--line)]">
        <label className="block px-4 py-3">
          <LabelWithInfo
            tip="Solo cambia cómo se muestran las horas en la app. Los ciclos siguen iguales."
            example="Un partido a las 20h en Madrid se ve a tu hora de Sydney."
          >
            Tu zona horaria
          </LabelWithInfo>
          <select
            className="mt-2 w-full appearance-none bg-transparent text-[17px] outline-none"
            value={s.timezone}
            onChange={(e) => updateSettings({ timezone: e.target.value })}
          >
            <option value="Australia/Sydney">Sydney</option>
            <option value="Australia/Melbourne">Melbourne</option>
            <option value="Pacific/Auckland">Auckland</option>
            <option value="UTC">UTC</option>
            <option value="America/Mexico_City">Ciudad de México</option>
            <option value="Europe/Madrid">Madrid</option>
          </select>
        </label>

        <label className="block px-4 py-3">
          <LabelWithInfo
            tip="Qué tan “exigente” es el motor. Número más alto = más SKIP, menos apuestas flojas."
            example="Con 82 pide picks decentes. Después de 2 losses sube solo un rato."
            trailing={
              <span className="text-[var(--muted)]">{s.scoreThreshold}</span>
            }
          >
            Qué tan exigente
          </LabelWithInfo>
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
            [
              "vaultSplitEarly",
              "Ahorro al empezar (racha 1–36)",
              "Cuando ganás al principio, ¿cuánto del premio va a la caja fuerte?",
              "Ganás $10 de profit · 20% → $2 al Vault, $8 siguen en juego.",
              s.vaultSplitEarly,
            ],
            [
              "vaultSplitMid",
              "Ahorro a mitad (racha 37–72)",
              "En la mitad de la racha, guardás más en la caja fuerte.",
              "Profit $10 · 50% → $5 al Vault, $5 siguen arriesgados.",
              s.vaultSplitMid,
            ],
            [
              "vaultSplitLate",
              "Ahorro al final (racha 73–108)",
              "Cerca del objetivo 108, la mayor parte del premio se guarda.",
              "Profit $10 · 70% → $7 al Vault. Protegés lo ganado.",
              s.vaultSplitLate,
            ],
          ] as const
        ).map(([key, label, tip, example, value]) => (
          <label key={key} className="block px-4 py-3">
            <LabelWithInfo
              tip={tip}
              example={example}
              trailing={
                <span className="text-[var(--muted)]">
                  {Math.round(value * 100)}%
                </span>
              }
            >
              {label}
            </LabelWithInfo>
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
          Buscar partidos de nuevo
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ color: "var(--ios-red)" }}
          onClick={() => {
            if (
              confirm(
                "¿Borrar toda la plata simulada y empezar de cero? No se puede deshacer.",
              )
            ) {
              resetAll();
            }
          }}
        >
          Empezar de cero
        </button>
      </div>
    </div>
  );
}
