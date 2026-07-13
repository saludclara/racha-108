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
  type ScoredPick,
} from "@/lib/engine";

const STORAGE_KEY = "racha-108-state-v1";

type AppContextValue = {
  state: AppState;
  ready: boolean;
  threshold: number;
  tiltActive: boolean;
  refreshPick: () => void;
  placeAndResolve: () => void;
  skipHour: () => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  resetAll: () => void;
  forceNewHour: () => void;
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

function ensureHourPick(state: AppState, now = new Date()): AppState {
  const hourKey = hourKeyFor(now, state.settings.timezone);

  if (
    state.lastResolvedHourKey === hourKey &&
    (state.pickStatus === "resolved" || state.pickStatus === "skipped")
  ) {
    return { ...state, currentHourKey: hourKey };
  }

  if (
    state.currentHourKey === hourKey &&
    state.currentPick &&
    (state.pickStatus === "ready" || state.pickStatus === "placed")
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
      `Ningún pick ≥ ${threshold}. SKIP para proteger la racha.`,
      now,
    );
  }

  return {
    ...state,
    currentHourKey: hourKey,
    currentPick: pick,
    pickStatus: "ready",
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

  // After client hydration flag flips, merge localStorage once
  const [didLoad, setDidLoad] = useState(false);
  if (hydrated && !didLoad) {
    setDidLoad(true);
    setState(ensureHourPick(loadState()));
  }

  useEffect(() => {
    if (!didLoad) return;
    saveState(state);
  }, [state, didLoad]);

  useEffect(() => {
    if (!didLoad) return;
    const id = setInterval(() => {
      setState((s) => ensureHourPick(s));
    }, 15_000);
    return () => clearInterval(id);
  }, [didLoad]);

  const threshold = useMemo(
    () => effectiveThreshold(state.settings, state.tiltGuardUntil),
    [state.settings, state.tiltGuardUntil],
  );

  const tiltActive = isTiltActive(state.tiltGuardUntil);

  const refreshPick = useCallback(() => {
    setState((s) => {
      const hourKey = hourKeyFor(new Date(), s.settings.timezone);
      if (s.pickStatus === "resolved" || s.pickStatus === "skipped") return s;
      if (s.lastResolvedHourKey === hourKey) return s;
      return ensureHourPick({
        ...s,
        currentHourKey: null,
        currentPick: null as ScoredPick | null,
        pickStatus: "idle",
      });
    });
  }, []);

  const placeAndResolve = useCallback(() => {
    setState((s) => {
      if (!s.currentPick || s.pickStatus !== "ready") return s;
      if (s.goalReached) return s;
      const pick = s.currentPick;
      const won = simulateOutcome(pick);
      if (won) return applyWin(s, pick);
      return applyLoss(s, pick);
    });
  }, []);

  const skipHour = useCallback(() => {
    setState((s) => {
      const hourKey =
        s.currentHourKey ?? hourKeyFor(new Date(), s.settings.timezone);
      if (s.lastResolvedHourKey === hourKey) return s;
      return applySkip(s, hourKey, "Skip manual — preservar racha.");
    });
  }, []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setState((s) => ({
      ...s,
      settings: { ...s.settings, ...patch },
    }));
  }, []);

  const resetAll = useCallback(() => {
    setState(ensureHourPick(createInitialState()));
  }, []);

  const forceNewHour = useCallback(() => {
    setState((s) => {
      const base =
        s.currentHourKey ?? hourKeyFor(new Date(), s.settings.timezone);
      const [datePart, hourPart] = base.split("T");
      const h = (Number(hourPart) + 1) % 24;
      const fakeKey = `${datePart}T${String(h).padStart(2, "0")}`;
      const thresholdNow = effectiveThreshold(s.settings, s.tiltGuardUntil);
      const matches = generateSimMatches(`${fakeKey}-force`);
      const pick = pickBestForHour(matches, fakeKey, thresholdNow);
      if (!pick) {
        return applySkip(
          { ...s, currentHourKey: fakeKey },
          fakeKey,
          `Demo hour: ningún pick ≥ ${thresholdNow}.`,
        );
      }
      return {
        ...s,
        currentHourKey: fakeKey,
        currentPick: pick,
        pickStatus: "ready",
        lastResolvedHourKey: null,
      };
    });
  }, []);

  const value: AppContextValue = {
    state,
    ready: didLoad,
    threshold,
    tiltActive,
    refreshPick,
    placeAndResolve,
    skipHour,
    updateSettings,
    resetAll,
    forceNewHour,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
