import type { MatchCandidate } from "./types";

const DEEP_FOOTBALL_MINUTE = 70;
const DEEP_FOOTBALL_ELAPSED_MS = 70 * 60_000;
/** ~70% of estimated 50m esports match */
const DEEP_ESPORTS_ELAPSED_MS = 35 * 60_000;

function kickoffMs(m: MatchCandidate): number {
  return new Date(m.kickoffUtc ?? m.kickoff).getTime();
}

/** Bo3/Bo5 map score already clinches the series (feed may still say inplay). */
export function isEsportsSeriesDecided(match: MatchCandidate): boolean {
  if (match.sport !== "esports") return false;
  const hs = match.homeScore;
  const as = match.awayScore;
  if (hs == null || as == null) return false;
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return false;
  return hs >= 2 || as >= 2;
}

/** Late live / near-FT — not a value window. */
export function isDeepLive(match: MatchCandidate, now = new Date()): boolean {
  if (match.status !== "inplay") return false;
  const kick = kickoffMs(match);
  const elapsed = Number.isFinite(kick) ? now.getTime() - kick : 0;

  if (match.sport === "esports") {
    if (isEsportsSeriesDecided(match)) return true;
    return elapsed >= DEEP_ESPORTS_ELAPSED_MS;
  }

  if (typeof match.minute === "number" && Number.isFinite(match.minute)) {
    return match.minute >= DEEP_FOOTBALL_MINUTE;
  }
  return elapsed >= DEEP_FOOTBALL_ELAPSED_MS;
}
