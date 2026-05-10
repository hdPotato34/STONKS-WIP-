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
      ? 0.018 + Math.max(0, -memory.drawdownFrom10dHigh - 20) * 0.001 + memory.limitDownDays5d * 0.007
      : 0;
  const crowdedSupply =
    memory.return5d > 16 || memory.upStreak >= 4 || memory.ma5Deviation > 9
      ? (0.0035 + Math.max(0, memory.return5d - 14) * 0.00034 + Math.max(0, memory.upStreak - 3) * 0.0014) *
        (stock.marketCap > 50_000_000_000 ? 1.35 : 1)
      : 0;
  const largeCapOverrunSupply =
    stock.marketCap > 50_000_000_000 && valuation.valuationGap > 0.55
      ? 0.012 + Math.max(0, valuation.valuationGap - 0.55) * 0.018 + Math.max(0, memory.return5d - 12) * 0.00042
      : 0;

  const buyFactor =
    undervaluation * (0.006 + qualityBid * 0.006 + stock.institutionPresence / 24_000) +
    (panicOrWashout && healthy ? (0.007 + undervaluation * 0.024 + qualityBid * 0.012) : 0) +
    Math.max(0, valuation.profitYield - 4) * 0.00028 * (0.7 + marketMood * 0.6) +
    crashFloorBid;

  const sellFactor =
    overvaluation * (0.018 + qualityPenalty * 0.018 + stock.heat / 8_500) +
    (mania ? overvaluation * 0.024 + Math.max(0, stock.heat - 60) * 0.00042 : 0) +
    (fragile && stock.pe > stock.fairPe ? 0.004 + qualityPenalty * 0.009 : 0) +
    crowdedSupply +
    largeCapOverrunSupply;

  return {
    valuation,
    buyPressure: stock.currentLiquidity * buyFactor,
    sellPressure: stock.currentLiquidity * sellFactor
  };
}
