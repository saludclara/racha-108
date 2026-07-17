import { DEFAULT_TIMEZONE } from "./types";

/** One pick every 1h 11m 11s — mirrors the 11.11 stake theme. */
export const CYCLE_MS = (1 * 3600 + 11 * 60 + 11) * 1000; // 4_271_000

/** Fixed UTC epoch so cycle boundaries are stable across reloads. */
export const CYCLE_EPOCH_UTC = Date.UTC(2024, 0, 1, 0, 0, 11);

export function cycleIndex(date: Date): number {
  return Math.floor((date.getTime() - CYCLE_EPOCH_UTC) / CYCLE_MS);
}

export function cycleStart(index: number): Date {
  return new Date(CYCLE_EPOCH_UTC + index * CYCLE_MS);
}

export function cycleEnd(index: number): Date {
  return new Date(CYCLE_EPOCH_UTC + (index + 1) * CYCLE_MS);
}

function wallParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

/**
 * Stable key for the current 1:11:11 cycle.
 * Format: `YYYY-MM-DDTHH:MM:SS-c{index}` in the user's timezone (cycle start).
 */
export function hourKeyFor(date: Date, timeZone = DEFAULT_TIMEZONE): string {
  const idx = cycleIndex(date);
  const start = cycleStart(idx);
  const p = wallParts(start, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}-c${idx}`;
}

/** Extract `c{index}` from an hourKey (`…-c18746`). */
export function parseCycleIndex(hourKey: string | null | undefined): number | null {
  if (!hourKey) return null;
  const m = /-c(\d+)\s*$/.exec(hourKey);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Stable key for a known cycle index in the user's timezone. */
export function hourKeyForIndex(
  index: number,
  timeZone = DEFAULT_TIMEZONE,
): string {
  const start = cycleStart(index);
  const p = wallParts(start, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}-c${index}`;
}

export function nextHourBoundary(
  date: Date,
  _timeZone = DEFAULT_TIMEZONE,
): Date {
  return cycleEnd(cycleIndex(date));
}

export function msUntilNextHour(
  date = new Date(),
  timeZone = DEFAULT_TIMEZONE,
): number {
  return Math.max(0, nextHourBoundary(date, timeZone).getTime() - date.getTime());
}

export function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatMoneyAUD(amount: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(amount);
}

/** Pretty label for cycle key + optional ISO timestamp */
export function formatBetWhen(
  hourKey: string,
  atIso?: string,
  timeZone = DEFAULT_TIMEZONE,
): string {
  const clean = hourKey.split("-r")[0] ?? hourKey;
  const match = clean.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:-c\d+)?$/,
  );

  if (!match) {
    // Legacy wall-hour key `YYYY-MM-DDTHH`
    const [datePart, hourPart] = clean.split("T");
    if (!datePart || hourPart == null) {
      return atIso
        ? new Date(atIso).toLocaleString("es-AU", { timeZone })
        : hourKey;
    }
    const hourLabel = `${hourPart.slice(0, 2).padStart(2, "0")}:00`;
    const dateLabel = new Date(`${datePart}T12:00:00`).toLocaleDateString(
      "es-AU",
      { weekday: "short", day: "numeric", month: "short", timeZone },
    );
    if (atIso) {
      const clock = new Date(atIso).toLocaleTimeString("es-AU", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone,
      });
      return `${dateLabel} · ciclo ${hourLabel} · liquidada ${clock}`;
    }
    return `${dateLabel} · ciclo ${hourLabel}`;
  }

  const [, datePart, hh, mm, ss] = match;
  const clockLabel = `${hh}:${mm}${ss ? `:${ss}` : ""}`;
  const dateLabel = new Date(`${datePart}T12:00:00`).toLocaleDateString(
    "es-AU",
    { weekday: "short", day: "numeric", month: "short", timeZone },
  );

  if (atIso) {
    const clock = new Date(atIso).toLocaleTimeString("es-AU", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    });
    return `${dateLabel} · ciclo ${clockLabel} · liquidada ${clock}`;
  }
  return `${dateLabel} · ciclo ${clockLabel}`;
}
