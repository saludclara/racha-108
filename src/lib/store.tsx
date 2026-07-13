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
  applySkip,
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

const STORAGE_KEY = "racha-108-state-v2";

type AppContextValue = {
  state: AppState;
  ready: boolean;
  threshold: number;
  tiltActive: boolean;
  updateSettings: (patch: Partial<AppSettings>) => void;
  resetAll: () => void;
  /** Advance one simulated hour and auto-settle (demo / catch-up) */
  runNextHour: () => void;
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

function settlePick(state: AppState, pick: NonNullable<AppState["currentPick"]>) {
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
 * Automatic hourly engine:
 * — if this hour already settled → idle wait
 * — else compute best high-accuracy pick and settle immediately
 */
export function processHour(
  state: AppState,
  hourKey: string,
  now = new Date(),
): AppState {
  if (state.lastResolvedHourKey === hourKey) {
    return {
      ...state,
      currentHourKey: hourKey,
      pickStatus:
        state.pickStatus === "ready" ? "resolved" : state.pickStatus,
    };
  }

  if (
    state.currentHourKey === hourKey &&
    state.currentPick &&
    state.pickStatus === "resolved"
  ) {
    return state;
  }

  const threshold = effectiveThreshold(
    state.settings,
    state.tiltGuardUntil,
    now,
  );
  const matches = generateSimMatches(hourKey);
  const pick = pickBestForHour(matches, hourKey, threshold, now);

  if (!pick) {
    return applySkip(
      {
        ...state,
        currentHourKey: hourKey,
        currentPick: null,
        pickStatus: "idle",
      },
      hourKey,
      `Sin mercado con confianza ≥ umbral. SKIP automático.`,
      now,
    );
  }

  const withPick: AppState = {
    ...state,
    currentHourKey: hourKey,
    currentPick: pick,
    pickStatus: "ready",
  };

  return settlePick(withPick, pick);
}

function nextHourKey(baseKey: string): string {
  const [datePart, hourPart] = baseKey.split("T");
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

  // Tick every second: when the wall-clock hour flips, auto-settle next pick
  useEffect(() => {
    if (!didLoad) return;
    const id = setInterval(() => {
      setState((s) => {
        const hourKey = hourKeyFor(new Date(), s.settings.timezone);
        if (s.lastResolvedHourKey === hourKey) return s;
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
    const fresh = createInitialState();
    const hourKey = hourKeyFor(new Date(), fresh.settings.timezone);
    setState(processHour(fresh, hourKey));
  }, []);

  const runNextHour = useCallback(() => {
    setState((s) => {
      const base =
        s.currentHourKey ?? hourKeyFor(new Date(), s.settings.timezone);
      const fakeKey = nextHourKey(base);
      // Allow re-settling a synthetic hour for demo catch-up
      const cleared: AppState = {
        ...s,
        lastResolvedHourKey:
          s.lastResolvedHourKey === fakeKey ? null : s.lastResolvedHourKey,
      };
      return processHour(cleared, fakeKey);
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
