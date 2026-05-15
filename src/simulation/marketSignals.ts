import { MARKET_BEHAVIOR_CONFIG } from "./marketBehaviorConfig";

export type MarketMemorySignalInput = {
  return5d: number;
  return10d: number;
  upStreak: number;
  greenDays5d: number;
  downStreak: number;
  drawdownFrom10dHigh: number;
  ma5Deviation: number;
  valuationGap: number;
  limitUpDays5d: number;
};

const signalConfig = MARKET_BEHAVIOR_CONFIG.memorySignals;

export function calculateOverrunFatigue(memory: MarketMemorySignalInput): number {
  const config = signalConfig.overrunFatigue;
  return (
    Math.max(0, memory.return5d - config.return5dThreshold) * config.return5dWeight +
    Math.max(0, memory.return10d - config.return10dThreshold) * config.return10dWeight +
    Math.max(0, memory.upStreak - config.upStreakThreshold) * config.upStreakWeight +
    Math.max(0, memory.greenDays5d - config.greenDaysThreshold) * config.greenDaysWeight +
    Math.max(0, memory.ma5Deviation - config.ma5DeviationThreshold) * config.ma5DeviationWeight +
    (memory.return5d > config.valuationEligibleReturn5d || memory.greenDays5d >= config.valuationEligibleGreenDays
      ? Math.max(0, memory.valuationGap - config.valuationGapThreshold) *
        (memory.limitUpDays5d > 0 ? config.valuationWeightAfterLimitUp : config.valuationWeightDefault)
      : 0)
  );
}

export function calculateWashoutAttention(memory: Pick<MarketMemorySignalInput, "drawdownFrom10dHigh" | "downStreak">): number {
  const config = signalConfig.washoutAttention;
  return (
    Math.max(0, -memory.drawdownFrom10dHigh - config.drawdownThreshold) * config.drawdownWeight +
    Math.max(0, memory.downStreak - config.downStreakThreshold) * config.downStreakWeight
  );
}
