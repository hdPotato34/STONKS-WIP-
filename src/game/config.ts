import gameRules from "../config/gameRules.json";

export const GAME_CONFIG = {
  totalDays: gameRules.totalDays,
  dayDurationSeconds: gameRules.dayDurationSeconds,
  ticksPerDay: gameRules.ticksPerDay,
  tickDurationSeconds: gameRules.tickDurationSeconds,

  startingCash: gameRules.startingCash,
  targetNetWorth: gameRules.targetNetWorth,

  stockCount: gameRules.stockCount,

  mainBoardLimit: gameRules.boardLimits.main,
  growthBoardLimit: gameRules.boardLimits.growth,
  stBoardLimit: gameRules.boardLimits.st,

  maxAccountHeat: gameRules.maxAccountHeat,
  maxStockHeat: gameRules.maxStockHeat
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
