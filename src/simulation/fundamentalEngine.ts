import type { GameState, Stock } from "../game/types";
import { getValuationSnapshot, type ValuationSnapshot } from "../game/fundamentals";
import { getMarketMemory } from "./marketMemory";

export type FundamentalPressure = {
  valuation: ValuationSnapshot;
  buyPressure: number;
  sellPressure: number;
};

export function calculateFundamentalPressure(game: GameState, stock: Stock): FundamentalPressure {
  const valuation = getValuationSnapshot(stock);
  const memory = getMarketMemory(game, stock);
  const dayChangePct = ((stock.price - stock.previousClose) / stock.previousClose) * 100;
  const undervaluation = Math.max(0, -valuation.valuationGap);
  const overvaluation = Math.max(0, valuation.valuationGap);
  const healthy = stock.financialHealth >= 55;
  const fragile = stock.financialHealth < 42;
  const panicOrWashout =
    stock.boardState === "panic" ||
    stock.boardState === "limitDown" ||
    dayChangePct <= -4 ||
    (stock.retail.fear > 72 && stock.retail.panicSellers > 62);
  const mania =
    stock.boardState === "sealedLimitUp" ||
    stock.boardState === "attackingLimitUp" ||
    dayChangePct >= 6 ||
    stock.heat > 68 ||
    stock.retail.greed > 78;
  const qualityBid = healthy ? (stock.financialHealth - 50) / 50 : 0;
  const qualityPenalty = fragile ? (45 - stock.financialHealth) / 45 : 0;
  const marketMood = game.market.sentiment / 100;
  const crashFloorBid =
    (memory.drawdownFrom10dHigh < -28 || memory.return5d < -22 || memory.limitDownDays5d >= 2) && valuation.valuationGap < 0.18
      ? 0.026 +
        Math.max(0, -memory.drawdownFrom10dHigh - 18) * 0.0014 +
        memory.limitDownDays5d * 0.011 +
        Math.max(0, -valuation.valuationGap) * 0.018
      : 0;
  const capitulationSupplyBrake =
    memory.limitDownDays5d >= 3 && valuation.valuationGap < 0.22
      ? 0.5
      : memory.limitDownDays5d === 2 && valuation.valuationGap < 0.12
        ? 0.68
        : 1;
  const stairSupplySignal =
    Math.max(0, memory.return5d - 11) * 0.00045 +
    Math.max(0, memory.return10d - 18) * 0.00026 +
    Math.max(0, memory.upStreak - 2) * 0.001 +
    Math.max(0, memory.greenDays5d - 3) * 0.0014 +
    Math.max(0, memory.ma5Deviation - 5.5) * 0.00055;
  const crowdedSupply =
    memory.return5d > 12 || memory.upStreak >= 3 || memory.greenDays5d >= 4 || memory.ma5Deviation > 7
      ? (0.0034 + stairSupplySignal + Math.max(0, overvaluation - 0.35) * 0.01) *
        (stock.marketCap > 50_000_000_000 ? 1.25 : stock.marketCap > 10_000_000_000 ? 1.12 : 1)
      : 0;
  const largeCapOverrunSupply =
    stock.marketCap > 50_000_000_000 && (valuation.valuationGap > 0.3 || memory.return10d > 28 || memory.ma5Deviation > 8)
      ? 0.01 +
        Math.max(0, valuation.valuationGap - 0.3) * 0.034 +
        Math.max(0, memory.return5d - 10) * 0.00062 +
        Math.max(0, memory.return10d - 24) * 0.00046 +
        Math.max(0, memory.ma5Deviation - 7) * 0.0007
      : 0;
  const richRunnerSupply =
    valuation.valuationGap > 0.45 && (memory.return5d > 10 || memory.greenDays5d >= 4)
      ? 0.004 +
        Math.max(0, valuation.valuationGap - 0.45) * (memory.limitUpDays5d > 0 ? 0.01 : 0.018) +
        Math.max(0, memory.return5d - 10) * (memory.limitUpDays5d > 0 ? 0.0003 : 0.00055)
      : 0;

  const buyFactor =
    undervaluation * (0.006 + qualityBid * 0.006 + stock.institutionPresence / 24_000) +
    (panicOrWashout && healthy ? (0.007 + undervaluation * 0.024 + qualityBid * 0.012) : 0) +
    Math.max(0, valuation.profitYield - 4) * 0.00028 * (0.7 + marketMood * 0.6) +
    crashFloorBid;

  const sellFactor =
    (overvaluation * (0.018 + qualityPenalty * 0.018 + stock.heat / 8_500 + (stock.marketCap > 50_000_000_000 ? 0.008 : 0)) +
      (mania ? overvaluation * 0.024 + Math.max(0, stock.heat - 60) * 0.00042 : 0) +
      (fragile && stock.pe > stock.fairPe ? 0.004 + qualityPenalty * 0.009 : 0) +
      crowdedSupply +
      largeCapOverrunSupply +
      richRunnerSupply) *
    capitulationSupplyBrake;

  return {
    valuation,
    buyPressure: stock.currentLiquidity * buyFactor,
    sellPressure: stock.currentLiquidity * sellFactor
  };
}
