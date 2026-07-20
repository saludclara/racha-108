import type { SkipReason } from "./score";
import { formatOddsBand } from "./markets";

export type SkipCode = SkipReason | "catchup" | "unknown";

export type SkipDisplay = {
  title: string;
  detail: string;
  tip?: string;
  tipHref?: string;
};

const COPY: Record<SkipCode, SkipDisplay> = {
  no_book: {
    title: "Sin cuota bookmaker",
    detail: `Sin odds reales en ${formatOddsBand()} · HotStack intacto`,
    tip: "Activá The Odds API en Ajustes.",
    tipHref: "/settings",
  },
  empty_pool: {
    title: "Sin partidos en ventana",
    detail: "Nada liquidable ahora · HotStack intacto",
    tip: "El próximo ciclo vuelve a mirar el feed.",
  },
  deep_live: {
    title: "Live muy avanzado",
    detail: "Solo finales o minuto alto · HotStack intacto",
    tip: "Esperá kickoffs frescos.",
  },
  edge: {
    title: "Sin ventaja suficiente",
    detail: "Book sin edge o probabilidad mínima · HotStack intacto",
    tip: "Tras losses el filtro es más duro.",
  },
  decided: {
    title: "Mercado ya cerrado",
    detail: "El marcador liquidaba el pick · HotStack intacto",
    tip: "No hay win sin riesgo real.",
  },
  threshold: {
    title: "Bajo el umbral",
    detail: "Book ok, pero el score no alcanzó · HotStack intacto",
    tip: "Tras losses el umbral sube a propósito.",
  },
  catchup: {
    title: "Ciclo perdido",
    detail: "App cerrada · skip automático · HotStack intacto",
    tip: "El cron recupera el hilo en el próximo ciclo.",
  },
  unknown: {
    title: "Sin apuesta este ciclo",
    detail: "No hubo pick BOOK con edge · HotStack intacto",
    tip: "Reconsultá el feed o esperá el countdown.",
  },
};

export function parseSkipCode(message: string | null | undefined): SkipCode {
  if (!message) return "unknown";
  if (/ciclo perdido|app cerrada/i.test(message)) return "catchup";
  if (message.includes("empty_pool")) return "empty_pool";
  if (message.includes("no_book")) return "no_book";
  if (message.includes("deep_live")) return "deep_live";
  if (message.includes("decided")) return "decided";
  if (message.includes("threshold")) return "threshold";
  if (message.includes("edge")) return "edge";
  return "unknown";
}

export function skipDisplay(code: SkipCode): SkipDisplay {
  return COPY[code] ?? COPY.unknown;
}

export function skipDisplayFromNote(note: string | null | undefined): SkipDisplay {
  return skipDisplay(parseSkipCode(note));
}

/** Short pill label for timeline / historial. */
export function skipOutcomeLabel(): string {
  return "Sin apuesta";
}

/** Persisted note for new SKIP rows (human-readable, no codes). */
export function skipMessageForReason(reason: SkipReason): string {
  const d = skipDisplay(reason);
  return `${d.title} · ${d.detail}`;
}
