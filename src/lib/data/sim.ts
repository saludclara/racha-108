import { fairOdds, marketModelProb } from "@/lib/engine/model";
import type { MatchCandidate, MarketType, TeamStats } from "@/lib/engine/types";

function team(name: string, overrides: Partial<TeamStats> = {}): TeamStats {
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
  "Harbour North FC",
  "River City United",
  "Bayview Athletic",
  "Summit Rovers",
  "Ironbark FC",
  "Coastline United",
  "Red Sand FC",
  "Lake District AFC",
  "Crown Hills",
  "Pacific Gate FC",
];

const AWAY_POOL = [
  "Southern Drift",
  "Eastvale Wanderers",
  "North Pier SC",
  "Amber Field",
  "Copper Coast",
  "Willow Park",
  "Stone Harbour",
  "Coral Ridge",
  "Maple United",
  "Silverstream FC",
];

const LEAGUES = ["Racha Sim League", "Pacific Paper Cup", "Night Grind Division"];

export function generateSimMatches(hourKey: string): MatchCandidate[] {
  const rng = mulberry32(hashSeed(hourKey));
  const count = 5 + Math.floor(rng() * 2);
  const matches: MatchCandidate[] = [];

  for (let i = 0; i < count; i++) {
    const homeName = HOME_POOL[Math.floor(rng() * HOME_POOL.length)];
    let awayName = AWAY_POOL[Math.floor(rng() * AWAY_POOL.length)];
    if (awayName === homeName) {
      awayName =
        AWAY_POOL[(Math.floor(rng() * AWAY_POOL.length) + 3) % AWAY_POOL.length];
    }

    const lock = i === 0;

    const home = team(homeName, {
      attack: lock ? 0.95 + rng() * 0.12 : 0.9 + rng() * 0.55,
      defense: lock ? 0.48 + rng() * 0.1 : 0.75 + rng() * 0.45,
      form: lock ? [1, 1, 1, 1, 1] : [1, rng() > 0.4 ? 1 : 0.5, 1, 0.5, 1],
      xgFor: lock ? 0.9 + rng() * 0.2 : 1.2 + rng() * 0.7,
      xgAgainst: lock ? 0.38 + rng() * 0.12 : 0.85 + rng() * 0.5,
      shotsPerGame: lock ? 10 + rng() * 3 : 10 + rng() * 8,
      possession: lock ? 55 + rng() * 8 : 45 + rng() * 18,
      restDays: lock ? 6 + Math.floor(rng() * 2) : 3 + Math.floor(rng() * 4),
      injuries: lock ? 0 : Math.floor(rng() * 3),
      motivation: lock ? 0.9 : 0.55 + rng() * 0.35,
    });

    const away = team(awayName, {
      attack: lock ? 0.42 + rng() * 0.12 : 0.75 + rng() * 0.45,
      defense: lock ? 1.1 + rng() * 0.2 : 0.8 + rng() * 0.45,
      form: lock
        ? [0, 0.5, 0, 0.5, 0]
        : [0.5, rng() > 0.5 ? 1 : 0, 0.5, 0, 0.5],
      xgFor: lock ? 0.4 + rng() * 0.18 : 0.95 + rng() * 0.55,
      xgAgainst: lock ? 1.4 + rng() * 0.25 : 1.0 + rng() * 0.5,
      shotsPerGame: 7 + rng() * 5,
      possession: 38 + rng() * 14,
      restDays: 2 + Math.floor(rng() * 4),
      injuries: lock ? 2 + Math.floor(rng() * 2) : Math.floor(rng() * 3),
      motivation: lock ? 0.4 + rng() * 0.15 : 0.5 + rng() * 0.35,
    });

    const markets: MarketType[] = [
      "under_35",
      "under_25",
      "double_chance_1x",
      "btts_no",
      "draw_no_bet_home",
      "ah_home_m025",
      "home_win",
      "ah_home_m05",
    ];

    const odds: Partial<Record<MarketType, number>> = {};
    for (const m of markets) {
      if (!lock && (m === "home_win" || m === "ah_home_m05") && rng() > 0.5) {
        continue;
      }
      const p = marketModelProb(m, home, away);
      const soft =
        lock &&
        (m === "under_35" || m === "double_chance_1x" || m === "btts_no")
          ? 0.04
          : 0.02;
      odds[m] = fairOdds(p, soft);
    }

    matches.push({
      id: `${hourKey}-${i}`,
      kickoff: `${hourKey}:15:00`,
      league: LEAGUES[Math.floor(rng() * LEAGUES.length)],
      home,
      away,
      odds,
      matchday: 1 + Math.floor(rng() * 27),
    });
  }

  return matches;
}
