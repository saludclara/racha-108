import type { MarketType } from "./types";

/** Lore ≤5% combined — EV layers dominate ranking. */
export const SCORE_WEIGHTS = {
  football: 0.4,
  stats: 0.3,
  value: 0.25,
  numerology: 0.03,
  stars: 0.02,
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

function universalDayNumber(date: Date): number {
  return digitSum(date.getDate() + date.getMonth() + 1 + date.getFullYear());
}

function majorArcanaOfDay(date: Date): {
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

function hourVibration(hourKey: string): number {
  const digits = hourKey.replace(/\D/g, "");
  if (!digits) return 5;
  return digitSum(Number(digits.slice(-6)));
}

const GRIND_MARKETS: MarketType[] = [
  "under_35",
  "under_25",
  "double_chance_1x",
  "btts_no",
  "draw_no_bet_home",
];

export function computeNumerologyScore(
  date: Date,
  hourKey: string,
  matchday: number,
  market: MarketType,
  odds: number,
): { score: number; note: string } {
  const arcana = majorArcanaOfDay(date);
  const day = universalDayNumber(date);
  const hour = hourVibration(hourKey);
  const life = digitSum(matchday + day);
  const grindAff =
    GRIND_MARKETS.includes(market) &&
    (arcana.vibe === "grind" || arcana.vibe === "balance")
      ? 12
      : arcana.vibe === "chaos"
        ? -8
        : 0;
  const eleven =
    Math.abs(odds - 1.11) < 0.03 || day === 2 || hour === 2 ? 8 : 0;
  const score = Math.min(
    100,
    Math.max(20, 55 + grindAff + eleven + (life === 9 || life === 1 ? 6 : 0)),
  );
  return {
    score,
    note: `${arcana.name} · día ${day} · hora ${hour} · tip lore`,
  };
}

export function computeStarsScore(date: Date): { score: number; note: string } {
  const day = date.getUTCDate();
  const phase = day % 8;
  const lunar = [62, 58, 70, 66, 74, 60, 68, 64][phase] ?? 64;
  return {
    score: lunar,
    note: `fase ${phase}/7 · tip atmósfera (peso bajo)`,
  };
}
