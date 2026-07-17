import type { DataProvider, MatchCandidate } from "@/lib/engine/types";

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
}

/** Cross-provider identity: home+away+kickoff bucket (15 min). */
export function canonicalIdFor(match: {
  home: { name: string };
  away: { name: string };
  kickoffUtc?: string;
  kickoff: string;
}): string {
  const kick = new Date(match.kickoffUtc ?? match.kickoff).getTime();
  const bucket = Math.floor(kick / (15 * 60_000));
  return `${normalizeName(match.home.name)}-${normalizeName(match.away.name)}-${bucket}`;
}

const PROVIDER_PRIORITY: Record<DataProvider, number> = {
  espn: 3,
  "api-football": 2,
  pandascore: 2,
  "odds-api": 1,
};

function mergePair(a: MatchCandidate, b: MatchCandidate): MatchCandidate {
  const aPri = PROVIDER_PRIORITY[a.provider ?? "espn"] ?? 0;
  const bPri = PROVIDER_PRIORITY[b.provider ?? "espn"] ?? 0;
  const base = aPri >= bPri ? a : b;
  const other = aPri >= bPri ? b : a;

  const providers: MatchCandidate["providers"] = {
    ...(other.providers ?? {}),
    ...(base.providers ?? {}),
  };
  if (base.provider && base.externalId) {
    providers[base.provider] = base.externalId;
  }
  if (other.provider && other.externalId) {
    providers[other.provider] = other.externalId;
  }

  // Prefer finished status + scores from either
  const finished =
    base.status === "finished" || other.status === "finished"
      ? "finished"
      : base.status === "inplay" || other.status === "inplay"
        ? "inplay"
        : base.status ?? other.status;

  const homeScore =
    base.homeScore != null
      ? base.homeScore
      : other.homeScore != null
        ? other.homeScore
        : undefined;
  const awayScore =
    base.awayScore != null
      ? base.awayScore
      : other.awayScore != null
        ? other.awayScore
        : undefined;

  // Per-market: book odds always beat model-fabricated prices
  const odds = { ...base.odds };
  const oddsSource = { ...(base.oddsSource ?? {}) };
  for (const [k, v] of Object.entries(other.odds ?? {})) {
    const key = k as keyof typeof odds;
    const otherSrc = other.oddsSource?.[key];
    const baseSrc = oddsSource[key];
    if (v == null) continue;
    if (otherSrc === "book" || baseSrc !== "book") {
      odds[key] = v;
      if (otherSrc) oddsSource[key] = otherSrc;
    }
  }
  for (const [k, v] of Object.entries(base.oddsSource ?? {})) {
    const key = k as keyof typeof oddsSource;
    if (v === "book") oddsSource[key] = "book";
  }

  const minute =
    base.minute != null
      ? base.minute
      : other.minute != null
        ? other.minute
        : undefined;

  // Prefer form arrays that aren't flat 0.5 placeholders
  const formRichness = (f: number[]) =>
    f.reduce((s, x) => s + Math.abs(x - 0.5), 0);

  return {
    ...base,
    canonicalId: base.canonicalId ?? other.canonicalId,
    providers,
    status: finished,
    homeScore,
    awayScore,
    odds,
    oddsSource,
    minute,
    home: {
      ...base.home,
      form:
        formRichness(other.home.form) > formRichness(base.home.form)
          ? other.home.form
          : base.home.form,
      injuries: Math.min(base.home.injuries, other.home.injuries),
      restDays: Math.max(base.home.restDays, other.home.restDays),
    },
    away: {
      ...base.away,
      form:
        formRichness(other.away.form) > formRichness(base.away.form)
          ? other.away.form
          : base.away.form,
      injuries: Math.min(base.away.injuries, other.away.injuries),
      restDays: Math.max(base.away.restDays, other.away.restDays),
    },
  };
}

/** Dedup + merge fixtures from multiple providers. */
export function mergeMatches(lists: MatchCandidate[][]): MatchCandidate[] {
  const byCanonical = new Map<string, MatchCandidate>();

  for (const list of lists) {
    for (const raw of list) {
      const canonicalId = raw.canonicalId ?? canonicalIdFor(raw);
      const match = { ...raw, canonicalId };
      const existing = byCanonical.get(canonicalId);
      if (!existing) {
        byCanonical.set(canonicalId, match);
      } else {
        byCanonical.set(canonicalId, mergePair(existing, match));
      }
    }
  }

  return [...byCanonical.values()].sort(
    (a, b) =>
      new Date(a.kickoffUtc ?? a.kickoff).getTime() -
      new Date(b.kickoffUtc ?? b.kickoff).getTime(),
  );
}
