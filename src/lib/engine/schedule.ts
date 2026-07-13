import { DEFAULT_TIMEZONE } from "./types";

export function hourKeyFor(date: Date, timeZone = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}`;
}

export function nextHourBoundary(
  date: Date,
  timeZone = DEFAULT_TIMEZONE,
): Date {
  // Approximate next hour in local wall time via iterative search
  const currentKey = hourKeyFor(date, timeZone);
  let cursor = new Date(date.getTime());
  for (let i = 0; i < 120; i++) {
    cursor = new Date(cursor.getTime() + 60_000);
    if (hourKeyFor(cursor, timeZone) !== currentKey) {
      // snap to start of that minute-ish; refine to second 0
      cursor.setSeconds(0, 0);
      return cursor;
    }
  }
  return new Date(date.getTime() + 60 * 60 * 1000);
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

/** Pretty label for hourKey `YYYY-MM-DDTHH` + optional ISO timestamp */
export function formatBetWhen(
  hourKey: string,
  atIso?: string,
  timeZone = DEFAULT_TIMEZONE,
): string {
  const clean = hourKey.split("-r")[0] ?? hourKey;
  const [datePart, hourPart] = clean.split("T");
  if (!datePart || hourPart == null) {
    return atIso
      ? new Date(atIso).toLocaleString("es-AU", { timeZone })
      : hourKey;
  }
  const hourLabel = `${hourPart.padStart(2, "0")}:00`;
  const dateLabel = new Date(`${datePart}T12:00:00`).toLocaleDateString("es-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone,
  });
  if (atIso) {
    const clock = new Date(atIso).toLocaleTimeString("es-AU", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    });
    return `${dateLabel} · franja ${hourLabel} · liquidada ${clock}`;
  }
  return `${dateLabel} · franja ${hourLabel}`;
}

