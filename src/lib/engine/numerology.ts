import type { MarketType } from "./types";

export const SCORE_WEIGHTS = {
  football: 0.37,
  stats: 0.26,
  value: 0.2,
  numerology: 0.1,
  stars: 0.08,
} as const;

const MAJOR_ARCANA: { name: string; vibe: "grind" | "attack" | "balance" | "chaos" }[] = [
  { name: "El Loco", vibe: "chaos" },
  { name: "El Mago", vibe: "attack" },
  { name: "La Sacerdotisa", vibe: "grind" },
  { name: "La Emperatriz", vibe: "balance" },
  { name: "El Emperador", vibe: "attack" },
  { name: "El Hierofante", vibe: "grind" },
  { name: "Los Enamorados", vibe: "balance" },
  { name: "El Carro", vibe: "attack" },
  { name: "La Fuerza", vibe: "balance" },
  { name: "El Ermitaño", vibe: "grind" },
  { name: "La Rueda de la Fortuna", vibe: "chaos" },
  { name: "La Justicia", vibe: "balance" },
  { name: "El Colgado", vibe: "grind" },
  { name: "La Muerte", vibe: "chaos" },
  { name: "La Templanza", vibe: "grind" },
  { name: "El Diablo", vibe: "chaos" },
  { name: "La Torre", vibe: "chaos" },
  { name: "La Estrella", vibe: "balance" },
  { name: "La Luna", vibe: "chaos" },
  { name: "El Sol", vibe: "attack" },
  { name: "El Juicio", vibe: "balance" },
  { name: "El Mundo", vibe: "balance" },
];

function digitSum(n: number): number {
  let x = Math.abs(Math.floor(n));
  while (x > 9) {
    x = String(x)
      .split("")
      .reduce((a, d) => a + Number(d), 0);
  }
  return x;
}

function reduceToArcana(n: number): number {
  let x = Math.abs(Math.floor(n));
  while (x > 22) {
    x = String(x)
      .split("")
      .reduce((a, d) => a + Number(d), 0);
  }
  if (x < 1) x = 1;
  if (x > 22) x = ((x - 1) % 22) + 1;
  return x;
}

export function universalDayNumber(date: Date): number {
  return digitSum(date.getDate() + date.getMonth() + 1 + date.getFullYear());
}

export function personalYearNumber(date: Date): number {
  return digitSum(date.getDate() + date.getMonth() + 1 + date.getFullYear());
}

export function majorArcanaOfDay(date: Date): {
  number: number;
  name: string;
  vibe: "grind" | "attack" | "balance" | "chaos";
} {
  const raw =
    date.getDate() +
    date.getMonth() +
    1 +
    date.getFullYear() +
    digitSum(date.getDate()) * 3;
  const number = reduceToArcana(raw);
  const card = MAJOR_ARCANA[number - 1];
  return { number, name: card.name, vibe: card.vibe };
}

/** Pythagorean life-path style from full date */
export function lifePathNumber(date: Date): number {
  const compact = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  let sum = 0;
  for (const ch of compact) sum += Number(ch);
  return digitSum(sum);
}

export function hourVibration(hourKey: string): number {
  // Prefer cycle index (-cN); else HH:MM:SS digits; else legacy hour
  const cycleMatch = hourKey.match(/-c(\d+)$/);
  if (cycleMatch) {
    return digitSum(Number(cycleMatch[1]) + 11);
  }
  const timePart = hourKey.split("T")[1]?.split("-")[0] ?? "0";
  const digits = timePart.replace(/\D/g, "");
  return digitSum(Number(digits || "0") + 11);
}

function marketArcanaFit(
  market: MarketType,
  vibe: "grind" | "attack" | "balance" | "chaos",
): number {
  const grindMarkets: MarketType[] = [
    "under_35",
    "under_25",
    "btts_no",
    "double_chance_1x",
  ];
  const attackMarkets: MarketType[] = ["home_win", "ah_home_m05", "ah_home_m025"];
  if (vibe === "grind" && grindMarkets.includes(market)) return 14;
  if (vibe === "attack" && attackMarkets.includes(market)) return 12;
  if (
    vibe === "balance" &&
    (market.includes("double") || market === "draw_no_bet_home")
  )
    return 10;
  if (vibe === "chaos") return -8;
  return 4;
}

function stakeResonance(odds: number): number {
  // 11.11 → 1+1+1+1 = 4; 108 → 9
  const stakePull = digitSum(1111) === 4 ? 6 : 0;
  const goalPull = digitSum(108) === 9 ? 5 : 0;
  const oddsPull =
    digitSum(Math.round(odds * 100)) === digitSum(1111) ? 4 : 0;
  return stakePull + goalPull + oddsPull;
}

export function computeNumerologyScore(
  date: Date,
  hourKey: string,
  matchday: number,
  market: MarketType,
  odds: number,
): { score: number; note: string } {
  const arcana = majorArcanaOfDay(date);
  const uDay = universalDayNumber(date);
  const path = lifePathNumber(date);
  const hourVib = hourVibration(hourKey);
  const jornada = digitSum(matchday);

  let score = 52;
  score += marketArcanaFit(market, arcana.vibe);
  score += stakeResonance(odds);

  // Master numbers & sacred anchors
  if ([1, 2, 8, 9, 11, 22].includes(uDay)) score += 8;
  if (path === uDay) score += 5;
  if (hourVib === uDay || hourVib === path) score += 6;
  if (jornada === 9 || jornada === 1 || jornada === 8) score += 4;

  // Arcana-specific boosts for grind philosophy
  const grindArcana = [2, 9, 10, 12, 14, 15]; // Priestess, Hermit, Wheel tempered, Hanged, Temperance
  if (grindArcana.includes(arcana.number) && market.startsWith("under")) {
    score += 7;
  }

  score = Math.min(98, Math.max(35, score));

  const note = `Arcano ${arcana.number} ${arcana.name} · día ${uDay} · camino ${path} · hora ${hourVib} · jornada ${jornada}`;
  return { score, note };
}

export function computeStarsScore(date: Date): { score: number; note: string } {
  const synodic = 29.53058867;
  const knownNew = Date.UTC(2000, 0, 6, 18, 14);
  const days = (date.getTime() - knownNew) / 86400000;
  const phase = ((days % synodic) + synodic) % synodic;
  const phase01 = phase / synodic;

  const m = date.getMonth() + 1;
  const d = date.getDate();
  const md = m * 100 + d;
  const zodiacCuts = [120, 219, 321, 420, 521, 621, 723, 823, 923, 1023, 1122, 1222];
  let z = 0;
  for (let c = 0; c < zodiacCuts.length; c++) {
    if (md >= zodiacCuts[c]) z = c + 1;
  }
  z %= 12;

  const signs = [
    "Capricornio",
    "Acuario",
    "Piscis",
    "Aries",
    "Tauro",
    "Géminis",
    "Cáncer",
    "Leo",
    "Virgo",
    "Libra",
    "Escorpio",
    "Sagitario",
  ];

  // Waxing = momentum; full-ish = clarity for low-risk picks
  const lunarClarity = 1 - Math.abs(phase01 - 0.5) * 1.15;
  const earthWater = [0, 1, 2, 4, 6, 8].includes(z) ? 8 : 0;
  const weekday = date.getDay();
  const saturnDay = weekday === 6 ? 5 : 0; // Saturday discipline

  const score = Math.min(
    96,
    Math.max(40, 54 + lunarClarity * 24 + earthWater + saturnDay),
  );

  const phaseLabel =
    phase01 < 0.25
      ? "creciente"
      : phase01 < 0.5
        ? "cuarto creciente"
        : phase01 < 0.75
          ? "menguante"
          : "cuarto menguante";

  return {
    score,
    note: `${signs[z]} · luna ${phaseLabel} ${(phase01 * 100).toFixed(0)}%`,
  };
}
