"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  msUntilNextHour,
  type AppSettings,
  type AppState,
  type ScoredPick,
} from "@/lib/engine";
import type { HourlyPickResponse } from "@/lib/data/real";
import type { SourceStatus } from "@/lib/data/providers/types";

const STORAGE_KEY = "racha-108-state-v4-real";
const RUN_ID_KEY = "racha-108-run-id";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REMOTE_SAVE_DEBOUNCE_MS = 500;

type AppContextValue = {
  state: AppState;
  ready: boolean;
  runId: string | null;
  shareUrl: string | null;
  durableEnabled: boolean;
  threshold: number;
  tiltActive: boolean;
  apiMessage: string | null;
  matchCount: number;
  sources: SourceStatus[];
  updateSettings: (patch: Partial<AppSettings>) => void;
  resetAll: () => void;
  refreshNow: () => void;
};

const AppContext = createContext<AppContextValue | null>(null);

function loadLocalState(): AppState {
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

function saveLocalState(state: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function readStoredRunId(): string | null {
  if (typeof window === "undefined") return null;
  const fromUrl = new URLSearchParams(window.location.search).get("run")?.trim();
  if (fromUrl && UUID_RE.test(fromUrl)) return fromUrl;
  const fromLs = localStorage.getItem(RUN_ID_KEY)?.trim();
  if (fromLs && UUID_RE.test(fromLs)) return fromLs;
  return null;
}

function persistRunId(id: string) {
  localStorage.setItem(RUN_ID_KEY, id);
  const url = new URL(window.location.href);
  if (url.searchParams.get("run") !== id) {
    url.searchParams.set("run", id);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
}

function clearRunId() {
  localStorage.removeItem(RUN_ID_KEY);
  const url = new URL(window.location.href);
  if (url.searchParams.has("run")) {
    url.searchParams.delete("run");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
}

function buildShareUrl(runId: string): string {
  if (typeof window === "undefined") return `?run=${runId}`;
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("run", runId);
  return url.toString();
}

async function apiCreateRun(state: AppState): Promise<{ id: string; state: AppState } | null> {
  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
    cache: "no-store",
  });
  if (res.status === 503) return null;
  if (!res.ok) throw new Error(`create run ${res.status}`);
  return (await res.json()) as { id: string; state: AppState };
}

async function apiLoadRun(id: string): Promise<{ id: string; state: AppState } | null> {
  const res = await fetch(`/api/run?id=${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  if (res.status === 503) return null;
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`load run ${res.status}`);
  return (await res.json()) as { id: string; state: AppState };
}

async function apiSaveRun(id: string, state: AppState): Promise<boolean> {
  const res = await fetch("/api/run", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, state }),
    cache: "no-store",
  });
  if (res.status === 503) return false;
  if (!res.ok) throw new Error(`save run ${res.status}`);
  return true;
}

async function fetchHourly(
  hourKey: string,
  threshold: number,
  settings: AppSettings,
): Promise<HourlyPickResponse> {
  const qs = new URLSearchParams({
    hourKey,
    threshold: String(threshold),
    apiFootball: settings.enableApiFootball ? "1" : "0",
    oddsApi: settings.enableOddsApi ? "1" : "0",
    esports: settings.enableEsports ? "1" : "0",
  });
  const res = await fetch(`/api/hourly?${qs}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`API ${res.status}`);
  }
  return (await res.json()) as HourlyPickResponse;
}

async function fetchRefresh(
  pick: ScoredPick,
  settings: AppSettings,
): Promise<HourlyPickResponse> {
  const res = await fetch("/api/hourly", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pick,
      apiFootball: settings.enableApiFootball,
      oddsApi: settings.enableOddsApi,
      esports: settings.enableEsports,
    }),
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
      data.message ?? "Sin partidos reales en el feed este ciclo.",
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
  const [runId, setRunId] = useState<string | null>(null);
  const [durableEnabled, setDurableEnabled] = useState(false);
  const [apiMessage, setApiMessage] = useState<string | null>(null);
  const [matchCount, setMatchCount] = useState(0);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [tick, setTick] = useState(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runIdRef = useRef<string | null>(null);
  const bootstrappedRef = useRef(false);

  const threshold = useMemo(
    () => effectiveThreshold(state.settings, state.tiltGuardUntil),
    [state.settings, state.tiltGuardUntil],
  );

  const tiltActive = isTiltActive(state.tiltGuardUntil);

  const shareUrl = useMemo(
    () => (runId ? buildShareUrl(runId) : null),
    [runId],
  );

  // Bootstrap: local cache → remote run (URL / stored id / create+migrate)
  useEffect(() => {
    if (!hydrated || bootstrappedRef.current) return;
    bootstrappedRef.current = true;

    let cancelled = false;

    (async () => {
      const local = loadLocalState();
      const existingId = readStoredRunId();

      try {
        if (existingId) {
          const remote = await apiLoadRun(existingId);
          if (cancelled) return;
          if (remote) {
            persistRunId(remote.id);
            runIdRef.current = remote.id;
            setRunId(remote.id);
            setDurableEnabled(true);
            setState(remote.state);
            saveLocalState(remote.state);
            setDidLoad(true);
            return;
          }
          // Stale id or 503 → keep local and try create if configured
        }

        const created = await apiCreateRun(local);
        if (cancelled) return;
        if (created) {
          persistRunId(created.id);
          runIdRef.current = created.id;
          setRunId(created.id);
          setDurableEnabled(true);
          setState(created.state);
          saveLocalState(created.state);
        } else {
          setDurableEnabled(false);
          setState(local);
          saveLocalState(local);
        }
      } catch (err) {
        console.error(err);
        if (cancelled) return;
        setDurableEnabled(false);
        setState(local);
        saveLocalState(local);
      } finally {
        if (!cancelled) setDidLoad(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrated]);

  // Local + debounced remote persist
  useEffect(() => {
    if (!didLoad) return;
    saveLocalState(state);

    const id = runIdRef.current;
    if (!id || !durableEnabled) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void apiSaveRun(id, state).catch((err) => {
        console.error(err);
      });
    }, REMOTE_SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [state, didLoad, durableEnabled]);

  // One decision per 1:11:11 cycle
  useEffect(() => {
    if (!didLoad) return;
    let cancelled = false;

    (async () => {
      const cycleKey = hourKeyFor(new Date(), state.settings.timezone);

      try {
        let data: HourlyPickResponse;

        if (state.pickStatus === "pending" && state.currentPick) {
          // Hold across cycles until official FT — never void for rollover
          data = await fetchRefresh(state.currentPick, state.settings);
          if (cancelled) return;
          setMatchCount(data.matchCount);
          if (data.sources) setSources(data.sources);

          if (data.status === "pending") {
            setApiMessage(
              data.message ??
                "Esperando resultado · HotStack a riesgo",
            );
            setState((s) =>
              applyApiResult(s, s.currentHourKey ?? cycleKey, data),
            );
            return;
          }

          // Settled → book it
          const pickCycle = state.currentHourKey ?? data.hourKey;
          setState((s) => applyApiResult(s, pickCycle, data));
          if (cancelled) return;

          if (pickCycle === cycleKey) {
            setApiMessage(
              data.message ??
                "Liquidado con marcador real · HotStack listo",
            );
            return;
          }

          // Slot freed in a later cycle → decide current cycle (settleable only)
          data = await fetchHourly(cycleKey, threshold, state.settings);
        } else if (
          state.lastResolvedHourKey === cycleKey &&
          (state.pickStatus === "resolved" || state.pickStatus === "skipped")
        ) {
          setApiMessage(
            "Ciclo libre · HotStack listo · próxima decisión en el countdown.",
          );
          return;
        } else {
          // No open pick → decide this cycle (or SKIP if nothing settleable)
          data = await fetchHourly(cycleKey, threshold, state.settings);
        }

        if (cancelled) return;
        setApiMessage(data.message ?? null);
        setMatchCount(data.matchCount);
        if (data.sources) setSources(data.sources);
        setState((s) => applyApiResult(s, cycleKey, data));
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setApiMessage(
          "Error consultando el feed de partidos reales. Reintentando…",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cycle drivers
  }, [
    didLoad,
    tick,
    state.settings.timezone,
    state.settings.enableApiFootball,
    state.settings.enableOddsApi,
    state.settings.enableEsports,
    threshold,
    state.pickStatus,
    state.currentHourKey,
    state.lastResolvedHourKey,
  ]);

  // Hit each 1:11:11 boundary + settle polls
  useEffect(() => {
    if (!didLoad) return;
    let timeoutId: ReturnType<typeof setTimeout>;

    const arm = () => {
      const ms = msUntilNextHour(new Date(), state.settings.timezone);
      const delay = Math.max(250, Math.min(ms + 120, 15_000));
      timeoutId = setTimeout(() => {
        setTick((t) => t + 1);
        arm();
      }, delay);
    };

    arm();
    return () => clearTimeout(timeoutId);
  }, [didLoad, state.settings.timezone]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setState((s) => ({
      ...s,
      settings: { ...s.settings, ...patch },
    }));
  }, []);

  const resetAll = useCallback(() => {
    void (async () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem("racha-108-state-v3");
      localStorage.removeItem("racha-108-state-v2");
      clearRunId();
      runIdRef.current = null;
      setRunId(null);

      const fresh = createInitialState();
      setState(fresh);
      saveLocalState(fresh);

      try {
        const created = await apiCreateRun(fresh);
        if (created) {
          persistRunId(created.id);
          runIdRef.current = created.id;
          setRunId(created.id);
          setDurableEnabled(true);
          setState(created.state);
          saveLocalState(created.state);
        } else {
          setDurableEnabled(false);
        }
      } catch (err) {
        console.error(err);
        setDurableEnabled(false);
      }

      setTick((t) => t + 1);
    })();
  }, []);

  const refreshNow = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  const value: AppContextValue = {
    state,
    ready: didLoad,
    runId,
    shareUrl,
    durableEnabled,
    threshold,
    tiltActive,
    apiMessage,
    matchCount,
    sources,
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
