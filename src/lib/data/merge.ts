import type { DataProvider, MatchCandidate } from "@/lib/engine/types";

/** Common display → canonical stubs so ESPN ↔ Odds API stick together. */
const NAME_ALIASES: Record<string, string> = {
  manunited: "manchesterunited",
  manutd: "manchesterunited",
  mancity: "manchestercity",
  spurs: "tottenham",
  tottenhamhotspur: "tottenham",
  atleticomadrid: "atletico",
  atleticomadr: "atletico",
  atlmadrid: "atletico",
  intermilan: "inter",
  internazionalemilano: "inter",
  acmilan: "milan",
  psg: "parissaintgermain",
  parissg: "parissaintgermain",
  bayern: "bayernmunich",
  bayernmunchen: "bayernmunich",
  borussiadortmund: "dortmund",
  bvb: "dortmund",
  sportingcp: "sportinglisbon",
  sportinglisboa: "sportinglisbon",
  benfica: "slbenfica",
  porto: "fcporto",
  olympiquelyonnais: "lyon",
  olympiquemarseille: "marseille",
  asroma: "roma",
  sslazio: "lazio",
  napoli: "sscnapoli",
  juve: "juventus",
  barca: "barcelona",
  fcbayern: "bayernmunich",
  rbileipzig: "leipzig",
  rasporteipzig: "leipzig",
  wolverhampton: "wolves",
  wolverhamptonwanderers: "wolves",
  nottinghamforest: "nottingham",
  newcastleunited: "newcastle",
  westbrom: "westbromwich",
  brightonandhovealbion: "brighton",
  brightonhovealbion: "brighton",
  athleticobilbao: "athletic",
  athleticclub: "athletic",
  realsociedad: "sociedad",
  realsocieda: "sociedad",
  villarrealcf: "villarreal",
  getafecf: "getafe",
  sevillafc: "sevilla",
  realbetis: "betis",
  bocajuniors: "boca",
  riverplate: "river",
  flamengo: "crflamengo",
  saopaulo: "saopaulo",
  intermiami: "intermiami",
  lafc: "losangelesfc",
  lagalaxy: "losangelesgalaxy",
};

const STRIP_TOKENS =
  /^(fc|cf|sc|afc|cfc|ac|as|ss|rc|cd|ud|sd|club|deportivo|sporting|the)$/;

function stripNoise(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’.]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STRIP_TOKENS.test(t))
    .join("");
}

function normalizeName(name: string): string {
  let key = stripNoise(name);
  if (NAME_ALIASES[key]) return NAME_ALIASES[key];
  // Prefix / contains alias (e.g. "manchesterunitedfc" already stripped)
  for (const [alias, canon] of Object.entries(NAME_ALIASES)) {
    if (key === alias || key.startsWith(alias) || alias.startsWith(key)) {
      if (Math.min(key.length, alias.length) >= 6) return canon;
    }
  }
  return key.slice(0, 28);
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

/** Loose key without time — used for ±1 bucket rescue merge. */
function teamPairKey(match: MatchCandidate): string {
  return `${normalizeName(match.home.name)}-${normalizeName(match.away.name)}`;
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

function kickBucket(match: MatchCandidate): number {
  const kick = new Date(match.kickoffUtc ?? match.kickoff).getTime();
  return Math.floor(kick / (15 * 60_000));
}

/**
 * Second pass: same team pair, kickoff within ±1 bucket (15m),
 * so slight time skew still merges Odds API → ESPN live.
 */
function rescueNearDuplicates(matches: MatchCandidate[]): MatchCandidate[] {
  const byPair = new Map<string, MatchCandidate[]>();
  for (const m of matches) {
    const k = teamPairKey(m);
    const list = byPair.get(k) ?? [];
    list.push(m);
    byPair.set(k, list);
  }

  const used = new Set<string>();
  const out: MatchCandidate[] = [];

  for (const group of byPair.values()) {
    if (group.length === 1) {
      out.push(group[0]!);
      continue;
    }
    group.sort((a, b) => kickBucket(a) - kickBucket(b));
    for (let i = 0; i < group.length; i++) {
      const a = group[i]!;
      const idA = a.canonicalId ?? a.id;
      if (used.has(idA)) continue;
      let merged = a;
      used.add(idA);
      for (let j = i + 1; j < group.length; j++) {
        const b = group[j]!;
        const idB = b.canonicalId ?? b.id;
        if (used.has(idB)) continue;
        if (Math.abs(kickBucket(a) - kickBucket(b)) > 1) continue;
        // Different providers (or book+fixture) for same fixture → glue
        const sameProvider =
          (a.provider ?? "") === (b.provider ?? "") &&
          a.provider != null &&
          b.provider != null;
        if (sameProvider && a.id === b.id) continue;
        merged = mergePair(merged, b);
        used.add(idB);
      }
      out.push(merged);
    }
  }

  return out;
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

  const rescued = rescueNearDuplicates([...byCanonical.values()]);

  return rescued.sort(
    (a, b) =>
      new Date(a.kickoffUtc ?? a.kickoff).getTime() -
      new Date(b.kickoffUtc ?? b.kickoff).getTime(),
  );
}
