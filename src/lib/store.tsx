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
import { generateSimMatches } from "@/lib/data/sim";
import {
  applyLoss,
  applyWin,
  createInitialState,
  effectiveThreshold,
  hourKeyFor,
  isTiltActive,
  pickBestForHour,
  simulateOutcome,
  type AppSettings,
  type AppState,
} from "@/lib/engine";

const STORAGE_KEY = "racha-108-state-v3";

type AppContextValue = {
  state: AppState;
  ready: boolean;
  threshold: number;
  tiltActive: boolean;
  updateSettings: (patch: Partial<AppSettings>) => void;
  resetAll: () => void;
  runNextHour: () => void;
};

const AppContext = createContext<AppContextValue | null>(null);

function loadState(): AppState {
  if (typeof window === "undefined") return createInitialState();
  try {
    // Prefer v3; migrate/clear stuck v2 skips
    const raw =
      localStorage.getItem(STORAGE_KEY) ??
      localStorage.getItem("racha-108-state-v2");
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw) as AppState;
    const base = {
      ...createInitialState(),
      ...parsed,
      settings: { ...createInitialState().settings, ...parsed.settings },
    };
    // Don't carry over a stuck SKIP for the current hour
    if (base.pickStatus === "skipped") {
      return {
        ...base,
        pickStatus: "idle",
        currentPick: null,
        lastResolvedHourKey: null,
      };
    }
    return base;
  } catch {
    return createInitialState();
  }
}

function saveState(state: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  localStorage.removeItem("racha-108-state-v2");
}

function settlePick(
  state: AppState,
  pick: NonNullable<AppState["currentPick"]>,
) {
  if (state.goalReached) {
    return {
      ...state,
      currentHourKey: pick.hourKey,
      currentPick: pick,
      pickStatus: "resolved" as const,
      lastResolvedHourKey: pick.hourKey,
    };
  }
  const won = simulateOutcome(pick);
  return won ? applyWin(state, pick) : applyLoss(state, pick);
}

/**
 * Always produces and settles one pick for the hour. Never SKIP.
 */
export function processHour(
  state: AppState,
  hourKey: string,
  now = new Date(),
): AppState {
  if (state.lastResolvedHourKey === hourKey && state.pickStatus === "resolved") {
    return { ...state, currentHourKey: hourKey };
  }

  // Re-run if previous attempt was a skip stuck in storage
  if (state.lastResolvedHourKey === hourKey && state.pickStatus === "skipped") {
    // fall through and re-settle
  } else if (state.lastResolvedHourKey === hourKey) {
    return { ...state, currentHourKey: hourKey };
  }

  const threshold = effectiveThreshold(
    state.settings,
    state.tiltGuardUntil,
    now,
  );

  let pick;
  try {
    const matches = generateSimMatches(hourKey);
    pick = pickBestForHour(matches, hourKey, threshold, now);
  } catch {
    pick = pickBestForHour([], hourKey, threshold, now);
  }

  const withPick: AppState = {
    ...state,
    currentHourKey: hourKey,
    currentPick: pick,
    pickStatus: "ready",
    lastResolvedHourKey: null,
  };

  return settlePick(withPick, pick);
}

function nextHourKey(baseKey: string): string {
  const clean = baseKey.split("-r")[0] ?? baseKey;
  const [datePart, hourPart] = clean.split("T");
  const h = (Number(hourPart) + 1) % 24;
  return `${datePart}T${String(h).padStart(2, "0")}`;
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

  if (hydrated && !didLoad) {
    setDidLoad(true);
    const loaded = loadState();
    const hourKey = hourKeyFor(new Date(), loaded.settings.timezone);
    setState(processHour(loaded, hourKey));
  }

  useEffect(() => {
    if (!didLoad) return;
    saveState(state);
  }, [state, didLoad]);

  useEffect(() => {
    if (!didLoad) return;
    const id = setInterval(() => {
      setState((s) => {
        const hourKey = hourKeyFor(new Date(), s.settings.timezone);
        if (s.lastResolvedHourKey === hourKey && s.pickStatus === "resolved") {
          return s;
        }
        return processHour(s, hourKey);
      });
    }, 1000);
    return () => clearInterval(id);
  }, [didLoad]);

  const threshold = useMemo(
    () => effectiveThreshold(state.settings, state.tiltGuardUntil),
    [state.settings, state.tiltGuardUntil],
  );

  const tiltActive = isTiltActive(state.tiltGuardUntil);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setState((s) => ({
      ...s,
      settings: { ...s.settings, ...patch },
    }));
  }, []);

  const resetAll = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("racha-108-state-v2");
    const fresh = createInitialState();
    const hourKey = hourKeyFor(new Date(), fresh.settings.timezone);
    setState(processHour(fresh, hourKey));
  }, []);

  const runNextHour = useCallback(() => {
    setState((s) => {
      try {
        const base =
          s.currentHourKey ?? hourKeyFor(new Date(), s.settings.timezone);

        // If stuck on skip for this hour, re-settle the same hour first
        if (s.pickStatus === "skipped") {
          const cleared: AppState = {
            ...s,
            pickStatus: "idle",
            currentPick: null,
            lastResolvedHourKey: null,
          };
          return processHour(cleared, base);
        }

        const fakeKey = nextHourKey(base);
        const cleared: AppState = {
          ...s,
          pickStatus: "idle",
          currentPick: null,
          lastResolvedHourKey: null,
        };
        return processHour(cleared, fakeKey);
      } catch (err) {
        console.error("runNextHour failed", err);
        const hourKey = hourKeyFor(new Date(), s.settings.timezone);
        return processHour(
          {
            ...s,
            pickStatus: "idle",
            currentPick: null,
            lastResolvedHourKey: null,
          },
          `${hourKey}-recover`,
        );
      }
    });
  }, []);

  const value: AppContextValue = {
    state,
    ready: didLoad,
    threshold,
    tiltActive,
    updateSettings,
    resetAll,
    runNextHour,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
