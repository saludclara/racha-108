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
  applyHourlyResult,
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
import { adoptCloudState } from "@/lib/runs/merge";

const STORAGE_KEY = "racha-108-state-v4-real";
const LEGACY_STORAGE_KEYS = [
  "racha-108-state-v3",
  "racha-108-state-v2",
] as const;
const RUN_ID_KEY = "racha-108-run-id";
const RUN_COOKIE = "racha_run";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REMOTE_SAVE_DEBOUNCE_MS = 500;

type CloudBoot = {
  durable: boolean;
  runId: string | null;
  updatedAt: string | null;
  state: AppState;
  cloudConfigured: boolean;
};

/** One shared bootstrap — survives React Strict Mode double-mount. */
let cloudBootstrapPromise: Promise<CloudBoot> | null = null;

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

function parseStoredState(raw: string): AppState | null {
  try {
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      ...createInitialState(),
      ...parsed,
      settings: { ...createInitialState().settings, ...parsed.settings },
      history: Array.isArray(parsed.history) ? parsed.history : [],
      vaultLedger: Array.isArray(parsed.vaultLedger) ? parsed.vaultLedger : [],
    };
  } catch {
    return null;
  }
}

function loadLocalState(): AppState {
  if (typeof window === "undefined") return createInitialState();
  const primary = localStorage.getItem(STORAGE_KEY);
  if (primary) {
    const parsed = parseStoredState(primary);
    if (parsed) return parsed;
  }
  // Recover history from older keys if v4 was wiped / never written
  for (const key of LEGACY_STORAGE_KEYS) {
    const legacy = localStorage.getItem(key);
    if (!legacy) continue;
    const parsed = parseStoredState(legacy);
    if (parsed && (parsed.history.length > 0 || parsed.vault > 0)) {
      return parsed;
    }
  }
  return createInitialState();
}

function saveLocalState(state: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function readCookieRunId(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${RUN_COOKIE}=`));
  const v = match?.slice(RUN_COOKIE.length + 1)?.trim();
  return v && UUID_RE.test(v) ? v : null;
}

function readStoredRunId(): string | null {
  if (typeof window === "undefined") return null;
  const fromUrl = new URLSearchParams(window.location.search).get("run")?.trim();
  if (fromUrl && UUID_RE.test(fromUrl)) return fromUrl;
  const fromLs = localStorage.getItem(RUN_ID_KEY)?.trim();
  if (fromLs && UUID_RE.test(fromLs)) return fromLs;
  return readCookieRunId();
}

function persistRunId(id: string) {
  localStorage.setItem(RUN_ID_KEY, id);
  // Backup if localStorage is cleared but cookies remain
  document.cookie = `${RUN_COOKIE}=${id}; path=/; max-age=31536000; SameSite=Lax`;
  const url = new URL(window.location.href);
  if (url.searchParams.get("run") !== id) {
    url.searchParams.set("run", id);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
}

function clearRunId() {
  localStorage.removeItem(RUN_ID_KEY);
  document.cookie = `${RUN_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
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

type RunPayload = { id: string; state: AppState; updatedAt: string };

async function apiCreateRun(state: AppState): Promise<RunPayload | null | "unconfigured"> {
  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
    cache: "no-store",
  });
  if (res.status === 503) return "unconfigured";
  if (!res.ok) throw new Error(`create run ${res.status}`);
  return (await res.json()) as RunPayload;
}

/** Auto cloud sync — no need to copy any link for closed-tab cron picks. */
async function bootstrapCloud(local: AppState): Promise<CloudBoot> {
  if (!cloudBootstrapPromise) {
    cloudBootstrapPromise = (async (): Promise<CloudBoot> => {
      const existingId = readStoredRunId();
      if (existingId) {
        try {
          const remote = await apiLoadRun(existingId);
          if (remote) {
            persistRunId(remote.id);
            return {
              durable: true,
              runId: remote.id,
              updatedAt: remote.updatedAt,
              state: remote.state,
              cloudConfigured: true,
            };
          }
        } catch {
          // fall through to create/retry
        }
      }

      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const created = await apiCreateRun(local);
          if (created === "unconfigured") {
            return {
              durable: false,
              runId: null,
              updatedAt: null,
              state: local,
              cloudConfigured: false,
            };
          }
          if (created) {
            persistRunId(created.id);
            return {
              durable: true,
              runId: created.id,
              updatedAt: created.updatedAt,
              state: created.state,
              cloudConfigured: true,
            };
          }
        } catch {
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }

      return {
        durable: false,
        runId: null,
        updatedAt: null,
        state: local,
        cloudConfigured: true,
      };
    })();
  }
  return cloudBootstrapPromise;
}

async function apiLoadRun(id: string): Promise<RunPayload | null> {
  const res = await fetch(`/api/run?id=${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  if (res.status === 503) return null;
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`load run ${res.status}`);
  return (await res.json()) as RunPayload;
}

async function apiSaveRun(
  id: string,
  state: AppState,
  expectedUpdatedAt: string | null,
): Promise<
  | { kind: "ok"; payload: RunPayload }
  | { kind: "conflict"; payload: RunPayload }
  | "unavailable"
> {
  const res = await fetch("/api/run", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      state,
      expectedUpdatedAt: expectedUpdatedAt || undefined,
    }),
    cache: "no-store",
  });
  if (res.status === 503) return "unavailable";
  if (res.status === 409) {
    const body = (await res.json()) as RunPayload;
    return { kind: "conflict", payload: body };
  }
  if (!res.ok) throw new Error(`save run ${res.status}`);
  return { kind: "ok", payload: (await res.json()) as RunPayload };
}

async function fetchHourly(
  hourKey: string,
  threshold: number,
  settings: AppSettings,
  opts?: { tiltActive?: boolean; history?: AppState["history"] },
): Promise<HourlyPickResponse> {
  const res = await fetch("/api/hourly", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "pick",
      hourKey,
      threshold,
      tiltActive: opts?.tiltActive === true,
      history: (opts?.history ?? []).slice(0, 100).map((h) => ({
        outcome: h.outcome,
        league: h.league,
        provider: h.provider,
        edge: h.edge,
        modelProb: h.modelProb,
      })),
      apiFootball: settings.enableApiFootball,
      oddsApi: settings.enableOddsApi,
      esports: settings.enableEsports,
    }),
    cache: "no-store",
  });
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
  const updatedAtRef = useRef<string | null>(null);
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

  // Auto cloud: create/load durable run without user copying any link
  useEffect(() => {
    if (!hydrated || bootstrappedRef.current) return;
    bootstrappedRef.current = true;

    let cancelled = false;
    const local = loadLocalState();

    void bootstrapCloud(local)
      .then((boot) => {
        if (cancelled) return;
        const adopted = adoptCloudState(local, boot.state);
        if (boot.durable && boot.runId) {
          runIdRef.current = boot.runId;
          updatedAtRef.current = boot.updatedAt;
          setRunId(boot.runId);
          setDurableEnabled(true);
          setState(adopted);
          saveLocalState(adopted);
        } else {
          setDurableEnabled(false);
          setState(adopted);
          saveLocalState(adopted);
          if (boot.cloudConfigured) {
            setApiMessage(
              "Reintentando nube… para picks con la app cerrada",
            );
          }
        }
        setDidLoad(true);
      })
      .catch((err) => {
        console.error(err);
        if (cancelled) return;
        setDurableEnabled(false);
        setState(local);
        saveLocalState(local);
        setDidLoad(true);
      });

    return () => {
      cancelled = true;
    };
  }, [hydrated]);

  // If cloud create failed once, keep retrying (cron needs a run id)
  useEffect(() => {
    if (!didLoad || durableEnabled) return;
    let cancelled = false;

    const tryAgain = () => {
      cloudBootstrapPromise = null;
      const local = loadLocalState();
      void bootstrapCloud(local).then((boot) => {
        if (cancelled || !boot.durable || !boot.runId) return;
        const adopted = adoptCloudState(local, boot.state);
        runIdRef.current = boot.runId;
        updatedAtRef.current = boot.updatedAt;
        setRunId(boot.runId);
        setDurableEnabled(true);
        setState(adopted);
        saveLocalState(adopted);
        setApiMessage("Nube activa · picks aunque cierres la app");
      });
    };

    const id = window.setInterval(tryAgain, 20_000);
    tryAgain();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [didLoad, durableEnabled]);

  // Local + debounced remote persist
  useEffect(() => {
    if (!didLoad) return;
    saveLocalState(state);

    const id = runIdRef.current;
    if (!id || !durableEnabled) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void apiSaveRun(id, state, updatedAtRef.current)
        .then((result) => {
          if (result === "unavailable") return;
          updatedAtRef.current = result.payload.updatedAt;
          if (result.kind === "conflict" && result.payload.state) {
            // Cron (or another tab) won — adopt live fields, keep all history
            setState((local) => {
              const adopted = adoptCloudState(local, result.payload.state);
              saveLocalState(adopted);
              return adopted;
            });
          }
        })
        .catch((err) => {
          console.error(err);
        });
    }, REMOTE_SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [state, didLoad, durableEnabled]);

  // Same cycle engine open or closed:
  // - Closed + ?run= → cron calls buildHourlyPick / settle on the server
  // - Open → this effect uses the same /api/hourly (+ remote sync if durable)
  useEffect(() => {
    if (!didLoad) return;
    let cancelled = false;

    (async () => {
      try {
        let working = state;
        const id = runIdRef.current;

        // Durable: pull cron/server state first so open tab = closed-tab truth
        if (id && durableEnabled) {
          const remote = await apiLoadRun(id);
          if (cancelled) return;
          if (remote) {
            working = adoptCloudState(state, remote.state);
            updatedAtRef.current = remote.updatedAt;
            setState(working);
            saveLocalState(working);
          }
        }

        const cycleKey = hourKeyFor(new Date(), working.settings.timezone);
        const th = effectiveThreshold(
          working.settings,
          working.tiltGuardUntil,
        );

        let data: HourlyPickResponse;

        if (working.pickStatus === "pending" && working.currentPick) {
          // Identical settle path as cron (hard refresh + guarantee)
          data = await fetchRefresh(working.currentPick, working.settings);
          if (cancelled) return;
          setMatchCount(data.matchCount);
          if (data.sources) setSources(data.sources);

          if (data.status === "pending") {
            setApiMessage(
              data.message ??
                (durableEnabled
                  ? "Esperando resultado · cron + app usan el mismo pick"
                  : "Esperando resultado · HotStack a riesgo"),
            );
            setState((s) => {
              const base = adoptCloudState(s, working);
              return applyHourlyResult(
                base,
                base.currentHourKey ?? cycleKey,
                data,
              );
            });
            return;
          }

          const pickCycle = working.currentHourKey ?? data.hourKey;
          setState((s) =>
            applyHourlyResult(adoptCloudState(s, working), pickCycle, data),
          );
          if (cancelled) return;

          if (pickCycle === cycleKey) {
            setApiMessage(
              data.message ?? "Liquidado con marcador real · HotStack listo",
            );
            return;
          }

          // Settled an older cycle → choose current cycle (same API as cron)
          data = await fetchHourly(cycleKey, th, working.settings, {
            tiltActive: isTiltActive(working.tiltGuardUntil),
            history: working.history,
          });
        } else if (
          working.lastResolvedHourKey === cycleKey &&
          (working.pickStatus === "resolved" ||
            working.pickStatus === "skipped")
        ) {
          setApiMessage(
            durableEnabled
              ? "Ciclo libre · mismo motor que el cron · HotStack listo."
              : "Ciclo libre · HotStack listo · próxima decisión en el countdown.",
          );
          return;
        } else {
          // New cycle pick — same buildHourlyPick as /api/cron/cycle
          data = await fetchHourly(cycleKey, th, working.settings, {
            tiltActive: isTiltActive(working.tiltGuardUntil),
            history: working.history,
          });
        }

        if (cancelled) return;
        setApiMessage(data.message ?? null);
        setMatchCount(data.matchCount);
        if (data.sources) setSources(data.sources);
        setState((s) =>
          applyHourlyResult(adoptCloudState(s, working), cycleKey, data),
        );
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
    durableEnabled,
    state.settings.timezone,
    state.settings.enableApiFootball,
    state.settings.enableOddsApi,
    state.settings.enableEsports,
    threshold,
    state.pickStatus,
    state.currentPick?.match.id,
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
      updatedAtRef.current = null;
      cloudBootstrapPromise = null;
      setRunId(null);
      setDurableEnabled(false);

      const fresh = createInitialState();
      setState(fresh);
      saveLocalState(fresh);

      try {
        const boot = await bootstrapCloud(fresh);
        if (boot.durable && boot.runId) {
          runIdRef.current = boot.runId;
          updatedAtRef.current = boot.updatedAt;
          setRunId(boot.runId);
          setDurableEnabled(true);
          setState(boot.state);
          saveLocalState(boot.state);
        }
      } catch (err) {
        console.error(err);
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
