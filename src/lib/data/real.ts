import { fetchEspnMatches } from "@/lib/data/espn";
import { pickBestForHour } from "@/lib/engine/score";
import { settlePick } from "@/lib/engine/settle";
import type { MatchCandidate, ScoredPick } from "@/lib/engine/types";

export type HourlyPickResponse = {
  ok: true;
  hourKey: string;
  status: "pending" | "settled" | "empty";
  pick: ScoredPick | null;
  settle: "win" | "loss" | "push" | null;
  matchCount: number;
  message?: string;
  fetchedAt: string;
};

function isUpcomingOrLive(m: MatchCandidate, now: Date): boolean {
  if (m.status === "finished") return false;
  const kick = new Date(m.kickoffUtc ?? m.kickoff).getTime();
  // include matches from 2h ago (in play / delay) up to 72h ahead
  return kick >= now.getTime() - 2 * 3600_000 && kick <= now.getTime() + 72 * 3600_000;
}

export async function buildHourlyPick(
  hourKey: string,
  threshold: number,
  now = new Date(),
): Promise<HourlyPickResponse> {
  const all = await fetchEspnMatches(now);
  const liveOrUpcoming = all.filter((m) => isUpcomingOrLive(m, now));

  // Prefer not-yet-finished for new picks
  const candidates = liveOrUpcoming.filter((m) => m.status !== "finished");

  if (!candidates.length) {
    // Maybe we already have a finished match that was the pick — still empty for new selection
    return {
      ok: true,
      hourKey,
      status: "empty",
      pick: null,
      settle: null,
      matchCount: all.length,
      message:
        all.length === 0
          ? "No se pudieron obtener partidos de ESPN ahora. Reintentá en un minuto."
          : "No hay partidos reales programados o en juego en la ventana (72h).",
      fetchedAt: now.toISOString(),
    };
  }

  const pick = pickBestForHour(candidates, hourKey, threshold, now);

  if (!pick) {
    return {
      ok: true,
      hourKey,
      status: "empty",
      pick: null,
      settle: null,
      matchCount: candidates.length,
      message:
        "Hay partidos reales, pero ninguno pasa el filtro de bajo riesgo / confianza.",
      fetchedAt: now.toISOString(),
    };
  }

  const fresh =
    all.find(
      (m) => m.id === pick.match.id || m.externalId === pick.match.externalId,
    ) ?? pick.match;
  const refreshed: ScoredPick = { ...pick, match: fresh };

  if (fresh.status === "finished") {
    const settle = settlePick(refreshed);
    return {
      ok: true,
      hourKey,
      status: "settled",
      pick: refreshed,
      settle,
      matchCount: candidates.length,
      message: settle
        ? `Resultado real ${fresh.homeScore}-${fresh.awayScore}`
        : "Partido terminado sin marcador legible",
      fetchedAt: now.toISOString(),
    };
  }

  return {
    ok: true,
    hourKey,
    status: "pending",
    pick: refreshed,
    settle: null,
    matchCount: candidates.length,
    message: `Kickoff ${new Date(fresh.kickoffUtc ?? fresh.kickoff).toLocaleString("es-AU")}`,
    fetchedAt: now.toISOString(),
  };
}

/** Resolve a previously chosen pick by external id against live ESPN data */
export async function refreshPickSettlement(
  pick: ScoredPick,
  now = new Date(),
): Promise<HourlyPickResponse> {
  const all = await fetchEspnMatches(now);
  const fresh =
    all.find(
      (m) => m.id === pick.match.id || m.externalId === pick.match.externalId,
    ) ?? null;

  if (!fresh) {
    return {
      ok: true,
      hourKey: pick.hourKey,
      status: "pending",
      pick,
      settle: null,
      matchCount: all.length,
      message: "Partido no encontrado todavía en ESPN; seguimos esperando.",
      fetchedAt: now.toISOString(),
    };
  }

  const refreshed: ScoredPick = { ...pick, match: fresh, hourKey: pick.hourKey };
  if (fresh.status === "finished") {
    const settle = settlePick(refreshed);
    return {
      ok: true,
      hourKey: pick.hourKey,
      status: "settled",
      pick: refreshed,
      settle,
      matchCount: all.length,
      message: settle
        ? `Resultado real ${fresh.homeScore}-${fresh.awayScore}`
        : "FT sin marcador",
      fetchedAt: now.toISOString(),
    };
  }

  return {
    ok: true,
    hourKey: pick.hourKey,
    status: "pending",
    pick: refreshed,
    settle: null,
    matchCount: all.length,
    message: `En curso / programado · ${fresh.status}`,
    fetchedAt: now.toISOString(),
  };
}
