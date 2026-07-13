import type { MatchCandidate, MarketType, TeamStats } from "@/lib/engine/types";

function team(
  name: string,
  overrides: Partial<TeamStats> = {},
): TeamStats {
  return {
    name,
    attack: 1.1,
    defense: 1.0,
    form: [1, 1, 0.5, 1, 1],
    xgFor: 1.6,
    xgAgainst: 0.9,
    shotsPerGame: 14,
    possession: 55,
    restDays: 6,
    injuries: 1,
    motivation: 0.8,
    ...overrides,
  };
}

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return function rng() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOME_POOL = [
  "Sydney FC",
  "Melbourne City",
  "Auckland FC",
  "Brisbane Roar",
  "Western United",
  "Macarthur FC",
  "Adelaide United",
  "Perth Glory",
  "Wellington Phoenix",
  "Newcastle Jets",
];

const AWAY_POOL = [
  "Central Coast",
  "Western Sydney",
  "Melbourne Victory",
  "Canberra United",
  "Gold Coast United",
  "Tasmania Rovers",
  "Darwin Rangers",
  "Hobart City",
  "Geelong Mariners",
  "Cairns Titans",
];

const LEAGUES = ["A-League Sim", "NPL Elite Sim", "Pacific Cup Sim"];

function oddsNear(rng: () => number, base: number): number {
  const jitter = (rng() - 0.5) * 0.08;
  return Math.round(Math.max(1.05, Math.min(1.25, base + jitter)) * 100) / 100;
}

export function generateSimMatches(hourKey: string): MatchCandidate[] {
  const rng = mulberry32(hashSeed(hourKey));
  const count = 4 + Math.floor(rng() * 3);
  const matches: MatchCandidate[] = [];

  for (let i = 0; i < count; i++) {
    const homeName = HOME_POOL[Math.floor(rng() * HOME_POOL.length)];
    let awayName = AWAY_POOL[Math.floor(rng() * AWAY_POOL.length)];
    if (awayName === homeName) awayName = AWAY_POOL[(Math.floor(rng() * AWAY_POOL.length) + 1) % AWAY_POOL.length];

    // First match of the hour is a grind favorite so SKIP is rarer
    const whale = i === 0;
    const homeStrength = whale ? 1.25 + rng() * 0.25 : 0.85 + rng() * 0.55;
    const awayStrength = whale ? 0.55 + rng() * 0.25 : 0.55 + rng() * 0.45;

    const home = team(homeName, {
      attack: homeStrength * (1.0 + rng() * 0.4),
      defense: whale ? 0.55 + rng() * 0.25 : 0.7 + rng() * 0.5,
      form: whale
        ? [1, 1, 1, 1, 1]
        : [1, 1, rng() > 0.3 ? 1 : 0.5, 1, rng() > 0.4 ? 1 : 0.5],
      xgFor: whale ? 1.9 + rng() * 0.4 : 1.2 + homeStrength * 0.8,
      xgAgainst: whale ? 0.55 + rng() * 0.2 : 0.6 + (1.4 - homeStrength) * 0.5,
      shotsPerGame: 11 + homeStrength * 6,
      possession: whale ? 58 + rng() * 8 : 48 + homeStrength * 12,
      restDays: whale ? 6 : 4 + Math.floor(rng() * 4),
      injuries: whale ? 0 : Math.floor(rng() * 3),
      motivation: whale ? 0.85 + rng() * 0.1 : 0.65 + rng() * 0.3,
    });

    const away = team(awayName, {
      attack: awayStrength * (0.85 + rng() * 0.35),
      defense: whale ? 1.0 + rng() * 0.3 : 0.75 + rng() * 0.55,
      form: whale
        ? [0.5, 0, 0.5, 0, 0.5]
        : [rng() > 0.5 ? 1 : 0.5, 0.5, rng() > 0.5 ? 1 : 0, 0.5, rng() > 0.4 ? 1 : 0.5],
      xgFor: whale ? 0.7 + rng() * 0.3 : 0.8 + awayStrength * 0.7,
      xgAgainst: whale ? 1.4 + rng() * 0.3 : 0.9 + (1.3 - awayStrength) * 0.6,
      shotsPerGame: 8 + awayStrength * 5,
      possession: 40 + awayStrength * 10,
      restDays: 3 + Math.floor(rng() * 5),
      injuries: whale ? 2 + Math.floor(rng() * 2) : Math.floor(rng() * 4),
      motivation: whale ? 0.45 + rng() * 0.2 : 0.5 + rng() * 0.35,
    });

    const odds: Partial<Record<MarketType, number>> = {
      home_win: oddsNear(rng, whale ? 1.14 : 1.18),
      double_chance_1x: oddsNear(rng, whale ? 1.07 : 1.1),
      draw_no_bet_home: oddsNear(rng, whale ? 1.1 : 1.14),
      under_25: oddsNear(rng, 1.16),
      under_35: oddsNear(rng, whale ? 1.06 : 1.08),
      btts_no: oddsNear(rng, whale ? 1.12 : 1.15),
      ah_home_m025: oddsNear(rng, whale ? 1.13 : 1.17),
      ah_home_m05: oddsNear(rng, whale ? 1.18 : 1.2),
    };

    // Occasionally remove a market to vary candidates
    if (rng() > 0.7) delete odds.home_win;
    if (rng() > 0.75) delete odds.ah_home_m05;

    matches.push({
      id: `${hourKey}-${i}`,
      kickoff: `${hourKey}:30:00`,
      league: LEAGUES[Math.floor(rng() * LEAGUES.length)],
      home,
      away,
      odds,
      matchday: 1 + Math.floor(rng() * 27),
    });
  }

  return matches;
}
