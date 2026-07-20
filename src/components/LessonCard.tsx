import type { Lesson, LessonCause } from "@/lib/engine";

function causeLabel(cause: LessonCause): string {
  switch (cause) {
    case "EDGE_FALSO":
      return "Edge falso";
    case "MERCADO_TOXICO":
      return "Mercado tóxico";
    case "LIGA_DEBIL":
      return "Liga débil";
    case "CAPA_MENTIRA":
      return "Capa mintió";
    case "PROB_HINCHADA":
      return "Prob hinchada";
    case "TIMING_MALO":
      return "Timing malo";
    case "VARIANCE":
      return "Variance";
    default:
      return cause;
  }
}

type Props = {
  plainWhy?: string | null;
  plainFix?: string | null;
  cause?: LessonCause | null;
  homeScore?: number | null;
  awayScore?: number | null;
  expiresAt?: string | null;
  compact?: boolean;
};

/** Hypersimple Autopsia 1L block — qué pasó / qué aprendimos. */
export function LessonCard({
  plainWhy,
  plainFix,
  cause,
  homeScore,
  awayScore,
  expiresAt,
  compact = false,
}: Props) {
  if (!plainWhy && !plainFix) return null;

  return (
    <div
      className={
        compact
          ? "mt-2 rounded-xl bg-[var(--ios-fill-2)] p-3"
          : "mt-4 rounded-xl border border-[var(--line)] bg-[var(--ios-fill-2)] p-4"
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="pill"
          style={{
            color: "var(--ios-red)",
            background: "rgba(255,59,48,0.14)",
          }}
        >
          Autopsia 1L
        </span>
        {cause ? (
          <span className="pill pill-auto">{causeLabel(cause)}</span>
        ) : null}
        {homeScore != null && awayScore != null ? (
          <span className="text-[13px] font-semibold tabular-nums">
            FT {homeScore}–{awayScore}
          </span>
        ) : null}
        {expiresAt ? (
          <span className="text-[11px] text-[var(--muted)]">
            hasta{" "}
            {new Date(expiresAt).toLocaleString("es-AU", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        ) : null}
      </div>
      {plainWhy ? (
        <div className="mt-3">
          <p className="text-[12px] font-medium text-[var(--muted)]">
            Qué pasó
          </p>
          <p className="mt-0.5 text-[14px] leading-snug">{plainWhy}</p>
        </div>
      ) : null}
      {plainFix ? (
        <div className="mt-2">
          <p className="text-[12px] font-medium text-[var(--muted)]">
            Qué aprendimos
          </p>
          <p
            className="mt-0.5 text-[14px] font-medium leading-snug"
            style={{ color: "var(--ios-blue)" }}
          >
            {plainFix}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function lessonFromState(
  lesson: Lesson | undefined,
): Omit<Props, "compact"> | null {
  if (!lesson) return null;
  return {
    plainWhy: lesson.plainWhy,
    plainFix: lesson.plainFix,
    cause: lesson.cause,
    homeScore: lesson.homeScore,
    awayScore: lesson.awayScore,
    expiresAt: lesson.expiresAt,
  };
}
