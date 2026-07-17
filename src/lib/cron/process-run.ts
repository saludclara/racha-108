import {
  applySkip,
  effectiveThreshold,
  hourKeyFor,
  hourKeyForIndex,
  parseCycleIndex,
  type AppState,
} from "@/lib/engine";
import { applyHourlyResult } from "@/lib/engine/apply-hourly";
import {
  buildHourlyPickFromMatches,
  settlePendingAgainstSnapshot,
  type MatchFeedSnapshot,
} from "@/lib/data/real";

/** ~2 days of 1:11:11 cycles — avoid huge catch-up spam on dormant runs. */
export const MAX_CATCHUP_CYCLES = 36;

export type ProcessRunResult = {
  id: string;
  changed: boolean;
  actions: string[];
  state: AppState;
  matchCount: number;
};

function materiallyChanged(before: AppState, after: AppState): boolean {
  return (
    before.pickStatus !== after.pickStatus ||
    before.lastResolvedHourKey !== after.lastResolvedHourKey ||
    before.streak !== after.streak ||
    before.hotStack !== after.hotStack ||
    before.vault !== after.vault ||
    before.history.length !== after.history.length ||
    before.tiltGuardUntil !== after.tiltGuardUntil ||
    before.currentHourKey !== after.currentHourKey ||
    before.currentPick?.match.id !== after.currentPick?.match.id ||
    before.currentPick?.match.status !== after.currentPick?.match.status ||
    before.currentPick?.match.homeScore !== after.currentPick?.match.homeScore ||
    before.currentPick?.match.awayScore !== after.currentPick?.match.awayScore
  );
}

function filterFeed(
  snapshot: MatchFeedSnapshot,
  settings: AppState["settings"],
): MatchFeedSnapshot {
  const matches = snapshot.matches.filter((m) => {
    if (m.sport === "esports" && !settings.enableEsports) return false;
    return true;
  });
  return { matches, sources: snapshot.sources };
}

/**
 * Advance one durable run through settle / catch-up skips / current-cycle pick.
 * Uses a shared match snapshot so cron can process many runs in one invocation.
 * Pending picks use direct event lookup so FT never silently becomes a blank push.
 */
export async function processRunCycle(
  id: string,
  state: AppState,
  snapshot: MatchFeedSnapshot,
  now = new Date(),
): Promise<ProcessRunResult> {
  const actions: string[] = [];
  const tz = state.settings.timezone;
  const cycleKey = hourKeyFor(now, tz);
  const currentIdx = parseCycleIndex(cycleKey);
  const feed = filterFeed(snapshot, state.settings);
  const matchCount = feed.matches.length;
  let next = state;

  // 1) Settle or abandon an open pick first (hard path)
  if (next.pickStatus === "pending" && next.currentPick) {
    const data = await settlePendingAgainstSnapshot(
      next.currentPick,
      feed,
      now,
      {
        enableApiFootball: next.settings.enableApiFootball,
        enableOddsApi: next.settings.enableOddsApi,
        enableEsports: next.settings.enableEsports,
      },
    );
    const pickCycle = next.currentHourKey ?? data.hourKey;
    next = applyHourlyResult(next, pickCycle, data, now);
    actions.push(
      data.status === "pending"
        ? `hold:${data.hourKey}`
        : `settle:${data.settle}:${data.hourKey}`,
    );

    if (next.pickStatus === "pending") {
      return {
        id,
        changed: materiallyChanged(state, next),
        actions,
        state: next,
        matchCount,
      };
    }
  }

  // 2) Already done for this cycle
  if (
    next.lastResolvedHourKey === cycleKey &&
    (next.pickStatus === "resolved" || next.pickStatus === "skipped")
  ) {
    return {
      id,
      changed: materiallyChanged(state, next),
      actions: actions.length ? actions : ["noop:current"],
      state: next,
      matchCount,
    };
  }

  // 3) Catch up missed cycles (tab closed) as SKIP — cannot replay real picks
  if (currentIdx != null) {
    const lastIdx = parseCycleIndex(next.lastResolvedHourKey);
    const startIdx =
      lastIdx == null
        ? currentIdx
        : Math.min(currentIdx, lastIdx + 1);
    const from = Math.max(startIdx, currentIdx - MAX_CATCHUP_CYCLES);

    for (let i = from; i < currentIdx; i++) {
      const key = hourKeyForIndex(i, tz);
      if (next.lastResolvedHourKey === key) continue;
      next = applySkip(
        { ...next, currentHourKey: key, currentPick: null },
        key,
        "Ciclo perdido (app cerrada) · skip automático del cron",
        now,
      );
      actions.push(`catchup-skip:${key}`);
    }
  }

  // 4) Decide the current cycle
  if (
    next.lastResolvedHourKey === cycleKey &&
    (next.pickStatus === "resolved" || next.pickStatus === "skipped")
  ) {
    return {
      id,
      changed: materiallyChanged(state, next),
      actions,
      state: next,
      matchCount,
    };
  }

  const threshold = effectiveThreshold(
    next.settings,
    next.tiltGuardUntil,
    now,
  );
  const data = buildHourlyPickFromMatches(
    cycleKey,
    threshold,
    feed.matches,
    feed.sources,
    now,
  );
  next = applyHourlyResult(next, cycleKey, data, now);
  actions.push(
    data.status === "pending"
      ? `pick:${cycleKey}`
      : data.status === "empty"
        ? `skip:${cycleKey}`
        : `instant:${data.settle}:${cycleKey}`,
  );

  return {
    id,
    changed: materiallyChanged(state, next),
    actions,
    state: next,
    matchCount,
  };
}
