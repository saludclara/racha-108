"use client";

import Link from "next/link";
import { Countdown, Money } from "@/components/Countdown";
import { LessonCard } from "@/components/LessonCard";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import {
  consecutiveLossCount,
  formatBetWhen,
  isTiltActive,
  parseSkipCode,
  skipDisplay,
} from "@/lib/engine";
import { useApp } from "@/lib/store";

function statusTone(
  kind: "skip" | "pending" | "win" | "loss" | "push" | "idle",
): { color: string; bg: string } {
  if (kind === "pending")
    return { color: "var(--ios-orange)", bg: "rgba(255,149,0,0.14)" };
  if (kind === "win")
    return { color: "var(--ios-green)", bg: "rgba(52,199,89,0.14)" };
  if (kind === "loss")
    return { color: "var(--ios-red)", bg: "rgba(255,59,48,0.12)" };
  if (kind === "skip")
    return { color: "var(--ios-orange)", bg: "rgba(255,149,0,0.14)" };
  return { color: "var(--ios-blue)", bg: "rgba(0,122,255,0.12)" };
}

export default function PickPage() {
  const {
    state,
    ready,
    threshold,
    tiltActive,
    apiMessage,
    matchCount,
    sources,
    refreshNow,
  } = useApp();

  if (!ready) return null;

  const pick = state.currentPick;
  const last = state.history[0];
  const pending = state.pickStatus === "pending";
  const resolved = state.pickStatus === "resolved";
  const skipped = state.pickStatus === "skipped";
  const idle =
    state.pickStatus === "idle" ||
    state.pickStatus === "ready" ||
    (!pending && !resolved && !skipped);

  const skipCode = parseSkipCode(apiMessage ?? last?.note);
  const skipMeta = skipDisplay(skipCode);
  const skip = {
    title: skipMeta.title,
    body: skipMeta.detail,
    tip: skipMeta.tip ?? "",
    tipHref: skipMeta.tipHref,
  };
  const lossStreak = consecutiveLossCount(state.history);
  const tiltOn = tiltActive || isTiltActive(state.tiltGuardUntil);
  const oddsSource = sources.find((s) => s.id === "odds-api");
  const bookReady = Boolean(oddsSource?.configured && oddsSource.ok);

  const mode: "skip" | "pending" | "resolved" | "idle" = pending
    ? "pending"
    : resolved
      ? "resolved"
      : skipped
        ? "skip"
        : "idle";

  return (
    <div className="rise space-y-4">
      <header className="pt-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <p className="section-label !mb-0 !normal-case !tracking-normal">
              Ciclo
            </p>
            <span className="pill pill-auto">
              {pending ? "EN JUEGO" : skipped || idle ? "LIBRE" : "CERRADO"}
            </span>
          </div>
          <span className="pill pill-auto">{matchCount} feed</span>
        </div>
        <h1 className="large-title mt-1">
          {mode === "pending"
            ? "Pick en riesgo"
            : mode === "resolved"
              ? "Liquidado"
              : mode === "skip"
                ? skip.title
                : "Apuesta del ciclo"}
        </h1>
      </header>

      {/* Next decision clock — always visible */}
      <section className="ios-card overflow-hidden p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] text-[var(--muted)]">Próxima decisión</p>
            <Countdown />
          </div>
          <div className="text-right">
            <p className="text-[12px] text-[var(--muted)]">HotStack</p>
            <p className="text-[22px] font-semibold tracking-tight">
              <Money amount={state.hotStack} />
            </p>
            <span
              className="pill mt-1 inline-flex"
              style={
                pending
                  ? statusTone("pending")
                  : {
                      color: "var(--ios-green)",
                      background: "rgba(52,199,89,0.14)",
                    }
              }
            >
              {pending ? "a riesgo" : "intacto"}
            </span>
          </div>
        </div>
        {(tiltOn || lossStreak >= 2) && (
          <p
            className="mt-3 text-[13px]"
            style={{ color: "var(--warn)" }}
          >
            {lossStreak >= 2
              ? `Modo post-${lossStreak}L · gates más duros · preferencia ${threshold}`
              : `Tilt guard · preferencia ${threshold}`}
          </p>
        )}
      </section>

      {/* SKIP hero */}
      {(skipped || (idle && /SKIP/i.test(apiMessage ?? ""))) && (
        <section className="ios-card p-5">
          <div className="flex items-center gap-2">
            <span className="pill pill-skip">SKIP</span>
            <span className="pill pill-auto">{skipCode}</span>
          </div>
          <h2 className="mt-3 text-[22px] font-semibold tracking-tight leading-snug">
            {skip.title}
          </h2>
          <p className="mt-2 text-[15px] text-[var(--muted)] leading-snug">
            {skip.body}
          </p>
          {apiMessage && (
            <p className="mt-2 text-[12px] text-[var(--muted)]">{apiMessage}</p>
          )}

          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              ["Book", bookReady ? "OK" : "off"],
              ["Feed", String(matchCount)],
              ["Pref.", String(threshold)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-[var(--ios-fill-2)] p-3">
                <p className="text-[11px] text-[var(--muted)]">{k}</p>
                <p
                  className="mt-0.5 text-[16px] font-semibold tracking-tight"
                  style={
                    k === "Book" && !bookReady
                      ? { color: "var(--ios-orange)" }
                      : undefined
                  }
                >
                  {v}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-4 text-[14px] text-[var(--muted)]">
            {skip.tip}{" "}
            {skip.tipHref && (
              <Link
                href={skip.tipHref}
                className="font-semibold"
                style={{ color: "var(--ios-blue)" }}
              >
                Ir a Ajustes →
              </Link>
            )}
          </p>

          <button
            type="button"
            className="btn btn-primary mt-4 w-full"
            onClick={refreshNow}
          >
            Reconsultar feed
          </button>
        </section>
      )}

      {/* Pending / resolved pick */}
      {pick && (pending || resolved) && (
        <article className="ios-card p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {pending && (
              <span className="pill" style={statusTone("pending")}>
                Esperando marcador
              </span>
            )}
            {resolved && last && (
              <span
                className="pill"
                style={statusTone(
                  last.outcome === "win"
                    ? "win"
                    : last.outcome === "loss"
                      ? "loss"
                      : "push",
                )}
              >
                {last.outcome === "win"
                  ? "WIN"
                  : last.outcome === "push"
                    ? "PUSH"
                    : last.outcome === "loss"
                      ? "LOSS"
                      : last.outcome.toUpperCase()}
              </span>
            )}
            <span className="pill pill-auto">
              {pick.oddsSource === "book" ? "BOOK" : "MODEL"}
            </span>
          </div>

          <p className="text-[13px] text-[var(--muted)]">
            {pick.match.league}
            {pick.match.status ? ` · ${pick.match.status}` : ""}
          </p>
          <h2 className="mt-1 text-[22px] font-semibold tracking-tight leading-snug">
            {pick.match.home.name}{" "}
            <span className="font-normal text-[var(--muted)]">vs</span>{" "}
            {pick.match.away.name}
          </h2>
          {(pick.match.homeScore != null || pick.match.awayScore != null) && (
            <p className="mt-1 text-[28px] font-bold tabular-nums tracking-tight">
              {pick.match.homeScore ?? "–"} – {pick.match.awayScore ?? "–"}
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

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Cuota", `@${pick.odds.toFixed(2)}`],
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
              ["p_model", `${(pick.modelProb * 100).toFixed(0)}%`],
              [
                "edge",
                pick.oddsSource === "book"
                  ? `${pick.edge >= 0 ? "+" : ""}${(pick.edge * 100).toFixed(1)}pp`
                  : "n/a",
              ],
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
            <p className="mt-3 text-[15px] text-[var(--muted)]">
              Profit <Money amount={last.profit ?? 0} /> · Vault +
              <Money amount={last.vaultAdded ?? 0} />
            </p>
          )}

          {resolved && last?.outcome === "loss" && (
            <div className="mt-4">
              <LessonCard
                plainWhy={last.plainWhy}
                plainFix={last.plainFix}
                cause={last.lessonCause}
                homeScore={last.homeScore ?? pick.match.homeScore}
                awayScore={last.awayScore ?? pick.match.awayScore}
                expiresAt={
                  state.lessons.find((l) => l.id === last.lessonId)?.expiresAt
                }
              />
            </div>
          )}

          <div className="mt-5 border-t border-[var(--line)] pt-4">
            <ScoreBreakdown total={pick.totalScore} layers={pick.layers} />
          </div>

          {pending && (
            <button
              type="button"
              className="btn btn-primary mt-4 w-full"
              onClick={refreshNow}
            >
              Chequear marcador
            </button>
          )}
        </article>
      )}

      {/* Idle without skip message */}
      {idle && !/SKIP/i.test(apiMessage ?? "") && !pick && (
        <section className="ios-card p-5">
          <span className="pill pill-auto">LISTO</span>
          <h2 className="mt-3 text-[22px] font-semibold tracking-tight">
            Esperando el ciclo
          </h2>
          <p className="mt-2 text-[15px] text-[var(--muted)]">
            El motor elige SKIP o 1 pick BOOK con edge. HotStack no se mueve
            hasta que haya valor real.
          </p>
          {apiMessage && (
            <p
              className="mt-2 text-[13px]"
              style={{ color: "var(--ios-blue)" }}
            >
              {apiMessage}
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary mt-4 w-full"
            onClick={refreshNow}
          >
            Consultar feed ahora
          </button>
        </section>
      )}

      {/* Feed sources */}
      {sources.length > 0 && (
        <section className="ios-card p-4">
          <p className="text-[13px] text-[var(--muted)]">Fuentes</p>
          <ul className="mt-2 divide-y divide-[var(--line)]">
            {sources.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 py-2.5 text-[14px]"
              >
                <span className="font-medium">{s.label}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums text-[var(--muted)]">
                    {s.count}
                  </span>
                  <span
                    className="pill"
                    style={
                      !s.configured
                        ? statusTone("skip")
                        : s.ok
                          ? statusTone("win")
                          : statusTone("loss")
                    }
                  >
                    {!s.configured
                      ? "sin key"
                      : s.ok
                        ? "ok"
                        : (s.error ?? "error")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Last cycle crumb */}
      {last && !pending && (
        <section className="ios-card p-4">
          <p className="text-[13px] text-[var(--muted)]">Último en historial</p>
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
            <p className="truncate text-[15px] font-medium">
              {last.matchLabel ?? last.note ?? "—"}
            </p>
          </div>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            {formatBetWhen(last.hourKey, last.at, state.settings.timezone)}
          </p>
          <Link
            href="/racha"
            className="mt-3 inline-block text-[14px] font-semibold"
            style={{ color: "var(--ios-blue)" }}
          >
            Ver racha →
          </Link>
        </section>
      )}
    </div>
  );
}
