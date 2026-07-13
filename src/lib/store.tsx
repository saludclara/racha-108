"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  applyLoss,
  applyPush,
  applySkip,
  applyWin,
  createInitialState,
  effectiveThreshold,
  hourKeyFor,
  isTiltActive,
  type AppSettings,
  type AppState,
  type ScoredPick,
} from "@/lib/engine";
import type { HourlyPickResponse } from "@/lib/data/real";

const STORAGE_KEY = "racha-108-state-v4-real";

type AppContextValue = {
  state: AppState;
  ready: boolean;
  threshold: number;
  tiltActive: boolean;
  apiMessage: string | null;
  matchCount: number;
  updateSettings: (patch: Partial<AppSettings>) => void;
  resetAll: () => void;
  refreshNow: () => void;
};

const AppContext = createContext<AppContextValue | null>(null);

function loadState(): AppState {
  if (typeof window === "undefined") return createInitialState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw) as AppState;
    return {
      ...createInitialState(),
      ...parsed,
      settings: { ...createInitialState().settings, ...parsed.settings },
    };
  } catch {
    return createInitialState();
  }
}

function saveState(state: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function fetchHourly(
  hourKey: string,
  threshold: number,
): Promise<HourlyPickResponse> {
  const res = await fetch(
    `/api/hourly?hourKey=${encodeURIComponent(hourKey)}&threshold=${threshold}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error(`API ${res.status}`);
  }
  return (await res.json()) as HourlyPickResponse;
}

async function fetchRefresh(pick: ScoredPick): Promise<HourlyPickResponse> {
  const res = await fetch("/api/hourly", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pick }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()) as HourlyPickResponse;
}

function applyApiResult(
  state: AppState,
  hourKey: string,
  data: HourlyPickResponse,
): AppState {
  if (data.status === "empty" || !data.pick) {
    if (state.lastResolvedHourKey === hourKey) return state;
    return applySkip(
      { ...state, currentHourKey: hourKey, currentPick: null },
      hourKey,
      data.message ?? "Sin partidos reales elegibles esta hora.",
    );
  }

  if (data.status === "pending") {
    return {
      ...state,
      currentHourKey: hourKey,
      currentPick: data.pick,
      pickStatus: "pending",
    };
  }

  // settled
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

  if (data.settle === "win") return applyWin(withPick, pick);
  if (data.settle === "push") return applyPush(withPick, pick);
  if (data.settle === "loss") return applyLoss(withPick, pick);

  return {
    ...withPick,
    pickStatus: "pending",
  };
}

function subscribeHydration(onStoreChange: () => void) {
  queueMicrotask(onStoreChange);
  return () => {};
}

function getHydrationSnapshot() {
  return true;
}

function getServerHydrationSnapshot() {
  return false;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    getHydrationSnapshot,
    getServerHydrationSnapshot,
  );

  const [state, setState] = useState<AppState>(() => createInitialState());
  const [didLoad, setDidLoad] = useState(false);
  const [apiMessage, setApiMessage] = useState<string | null>(null);
  const [matchCount, setMatchCount] = useState(0);
  const [tick, setTick] = useState(0);

  const threshold = useMemo(
    () => effectiveThreshold(state.settings, state.tiltGuardUntil),
    [state.settings, state.tiltGuardUntil],
  );

  const tiltActive = isTiltActive(state.tiltGuardUntil);

  if (hydrated && !didLoad) {
    setDidLoad(true);
    setState(loadState());
  }

  useEffect(() => {
    if (!didLoad) return;
    saveState(state);
  }, [state, didLoad]);

  // Fetch / refresh real ESPN pick
  useEffect(() => {
    if (!didLoad) return;
    let cancelled = false;

    (async () => {
      const hourKey = hourKeyFor(new Date(), state.settings.timezone);
      try {
        let data: HourlyPickResponse;

        if (
          state.pickStatus === "pending" &&
          state.currentPick &&
          state.currentHourKey === hourKey
        ) {
          data = await fetchRefresh(state.currentPick);
        } else if (
          state.lastResolvedHourKey === hourKey &&
          state.pickStatus === "resolved"
        ) {
          setApiMessage("Pick de esta hora ya liquidado con resultado real.");
          return;
        } else {
          data = await fetchHourly(hourKey, threshold);
        }

        if (cancelled) return;
        setApiMessage(data.message ?? null);
        setMatchCount(data.matchCount);
        setState((s) => applyApiResult(s, hourKey, data));
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setApiMessage(
          "Error consultando partidos reales (ESPN). Reintentando…",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional refresh drivers
  }, [
    didLoad,
    tick,
    state.settings.timezone,
    threshold,
    state.pickStatus,
    state.currentHourKey,
    state.lastResolvedHourKey,
  ]);

  // Poll while pending; also detect hour flip
  useEffect(() => {
    if (!didLoad) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [didLoad]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setState((s) => ({
      ...s,
      settings: { ...s.settings, ...patch },
    }));
  }, []);

  const resetAll = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("racha-108-state-v3");
    localStorage.removeItem("racha-108-state-v2");
    setState(createInitialState());
    setTick((t) => t + 1);
  }, []);

  const refreshNow = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  const value: AppContextValue = {
    state,
    ready: didLoad,
    threshold,
    tiltActive,
    apiMessage,
    matchCount,
    updateSettings,
    resetAll,
    refreshNow,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
