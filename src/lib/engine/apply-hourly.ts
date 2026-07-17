import {
  applyLoss,
  applyPending,
  applyPush,
  applySkip,
  applyWin,
} from "./bankroll";
import type { AppState } from "./types";
import type { HourlyPickResponse } from "@/lib/data/real";

/** Map an hourly API response onto AppState (win / loss / push / skip / pending). */
export function applyHourlyResult(
  state: AppState,
  hourKey: string,
  data: HourlyPickResponse,
  now = new Date(),
): AppState {
  if (data.status === "empty" || !data.pick) {
    if (state.lastResolvedHourKey === hourKey) return state;
    return applySkip(
      { ...state, currentHourKey: hourKey, currentPick: null },
      hourKey,
      data.message ?? "Sin partidos reales en el feed este ciclo.",
      now,
    );
  }

  if (data.status === "pending") {
    return applyPending(
      state,
      { ...data.pick, hourKey: data.pick.hourKey || hourKey },
      now,
      data.message,
    );
  }

  if (state.lastResolvedHourKey === hourKey && state.pickStatus === "resolved") {
    return {
      ...state,
      currentHourKey: hourKey,
      currentPick: data.pick,
    };
  }

  const pick = data.pick;
  const withPick: AppState = {
    ...state,
    currentHourKey: hourKey,
    currentPick: pick,
    pickStatus: "ready",
  };

  if (data.settle === "win") return applyWin(withPick, pick, now);
  if (data.settle === "push") {
    return applyPush(
      withPick,
      pick,
      now,
      data.message ?? "Push — stake devuelto",
    );
  }
  if (data.settle === "loss") return applyLoss(withPick, pick, now);

  // status === "settled" but settle missing → unlock (never re-pend forever)
  if (data.status === "settled") {
    return applyPush(
      withPick,
      pick,
      now,
      data.message ?? "Liquidación incompleta · push (stake devuelto)",
    );
  }

  return applyPending(withPick, pick, now, data.message);
}
