import type { HistoryEntry } from "./types";

/** Trailing W/L losses at the head of history (skips/pushes/pending ignored). */
export function consecutiveLossCount(history: HistoryEntry[]): number {
  let n = 0;
  for (const h of history) {
    if (
      h.outcome === "skip" ||
      h.outcome === "pending" ||
      h.outcome === "push"
    ) {
      continue;
    }
    if (h.outcome === "loss") {
      n += 1;
      continue;
    }
    break;
  }
  return n;
}
