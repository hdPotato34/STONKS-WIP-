export const GAME_CONFIG = {
  totalDays: 30,
  dayDurationSeconds: 300,
  ticksPerDay: 300,
  tickDurationSeconds: 1,

  startingCash: 1_000_000_000,
  targetNetWorth: 2_500_000_000,

  stockCount: 16,

  mainBoardLimit: 0.1,
  growthBoardLimit: 0.2,
  stBoardLimit: 0.05,

  maxAccountHeat: 100,
  maxStockHeat: 100
} as const;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roundShares(value: number): number {
  return Math.max(0, Math.floor(value));
}
