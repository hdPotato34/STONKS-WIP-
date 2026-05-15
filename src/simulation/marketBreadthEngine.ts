import { clamp } from "../game/config";
import type { GameState, MarketRegime, SectorId, Stock } from "../game/types";
import { MARKET_BEHAVIOR_CONFIG } from "./marketBehaviorConfig";

type SectorStats = {
  stocks: Stock[];
  avgReturn: number;
  advanceShare: number;
  hotBoardShare: number;
  weakBoardShare: number;
  limitDownShare: number;
  panicShare: number;
  avgSentiment: number;
  avgAttention: number;
  avgHeat: number;
  turnoverRatio: number;
  avgStress: number;
};

const breadthConfig = MARKET_BEHAVIOR_CONFIG.marketBreadth;

export function updateMarketBreadth(game: GameState): void {
  const sectorStats = new Map<SectorId, SectorStats>();

  for (const sectorId of Object.keys(game.sectors) as SectorId[]) {
    const stocks = Object.values(game.stocks).filter((stock) => stock.sector === sectorId && !stock.halted);
    const stats = buildSectorStats(stocks);
    sectorStats.set(sectorId, stats);
    updateSectorState(game, sectorId, stats);
  }

  updateMarketState(game, [...sectorStats.values()]);
}

function buildSectorStats(stocks: Stock[]): SectorStats {
  const count = Math.max(1, stocks.length);
  const avgReturn = average(stocks.map(getDayChangePct));
  const advanceShare = stocks.filter((stock) => getDayChangePct(stock) > 0.15).length / count;
  const hotBoardShare = stocks.filter((stock) => isHotBoard(stock)).length / count;
  const weakBoardShare = stocks.filter((stock) => isWeakBoard(stock)).length / count;
  const limitDownShare = stocks.filter((stock) => stock.boardState === "limitDown").length / count;
  const panicShare = stocks.filter((stock) => stock.boardState === "panic" || stock.boardState === "limitDown").length / count;

  return {
    stocks,
    avgReturn,
    advanceShare,
    hotBoardShare,
    weakBoardShare,
    limitDownShare,
    panicShare,
    avgSentiment: average(stocks.map((stock) => stock.sentiment)),
    avgAttention: average(stocks.map((stock) => stock.attention)),
    avgHeat: average(stocks.map((stock) => stock.heat)),
    turnoverRatio: average(stocks.map((stock) => stock.turnover / Math.max(1, stock.currentLiquidity))),
    avgStress: average(stocks.map((stock) => stock.microstructure.liquidityStress))
  };
}

function updateSectorState(game: GameState, sectorId: SectorId, stats: SectorStats): void {
  const sector = game.sectors[sectorId];
  const config = breadthConfig.sector;
  const breadth = stats.advanceShare - 0.5;
  const boardSpread = stats.hotBoardShare - stats.limitDownShare - stats.panicShare * 0.5;
  const sentimentTarget = clamp(
    50 +
      stats.avgReturn * config.returnSentimentWeight +
      breadth * config.breadthSentimentWeight +
      (stats.avgSentiment - 50) * config.avgStockSentimentWeight +
      stats.hotBoardShare * config.hotBoardSentimentWeight -
      (stats.weakBoardShare + stats.limitDownShare) * config.weakBoardSentimentWeight,
    0,
    100
  );
  const attentionTarget = clamp(
    stats.avgAttention * config.attentionStockWeight +
      stats.avgHeat * config.heatAttentionWeight +
      Math.min(1, stats.turnoverRatio) * config.turnoverAttentionWeight +
      (stats.hotBoardShare + stats.weakBoardShare + stats.limitDownShare) * config.boardAttentionWeight,
    0,
    100
  );
  const momentumTarget = clamp(
    stats.avgReturn * config.returnMomentumWeight +
      stats.hotBoardShare * config.limitUpMomentumWeight -
      stats.limitDownShare * config.limitDownMomentumWeight -
      stats.panicShare * config.panicMomentumWeight,
    -45,
    45
  );

  sector.sentiment = moveToward(sector.sentiment, sentimentTarget, config.sentimentSpeed, 0, 100);
  sector.attention = moveToward(sector.attention, attentionTarget, config.attentionSpeed, 0, 100);
  sector.momentum = moveToward(sector.momentum, momentumTarget + boardSpread * 8, config.momentumSpeed, -45, 45);
}

function updateMarketState(game: GameState, stats: SectorStats[]): void {
  const config = breadthConfig.market;
  const allStocks = stats.flatMap((sector) => sector.stocks);
  const count = Math.max(1, allStocks.length);
  const avgReturn = average(allStocks.map(getDayChangePct));
  const advanceShare = allStocks.filter((stock) => getDayChangePct(stock) > 0.15).length / count;
  const hotShare = allStocks.filter(isHotBoard).length / count;
  const weakShare = allStocks.filter(isWeakBoard).length / count;
  const limitDownShare = allStocks.filter((stock) => stock.boardState === "limitDown").length / count;
  const panicShare = allStocks.filter((stock) => stock.boardState === "panic" || stock.boardState === "limitDown").length / count;
  const avgStress = average(allStocks.map((stock) => stock.microstructure.liquidityStress));
  const avgHeat = average(allStocks.map((stock) => stock.heat));
  const sectorSentiment = average(Object.values(game.sectors).map((sector) => sector.sentiment));
  const sectorMomentum = average(Object.values(game.sectors).map((sector) => sector.momentum));
  const breadth = advanceShare - 0.5;
  const boardSpread = hotShare - limitDownShare - weakShare * 0.4;

  const sentimentTarget = clamp(
    50 +
      avgReturn * config.returnSentimentWeight +
      breadth * config.breadthSentimentWeight +
      boardSpread * config.boardSentimentWeight +
      (sectorSentiment - 50) * config.sectorSentimentWeight,
    0,
    100
  );
  const liquidityTarget = clamp(
    config.liquidityBase +
      breadth * config.liquidityBreadthWeight -
      avgStress * config.liquidityStressWeight / 100 -
      panicShare * config.liquidityPanicWeight -
      avgHeat * config.liquidityHeatWeight,
    25,
    86
  );
  const volatilityTarget = clamp(
    config.volatilityBase +
      Math.abs(avgReturn) * config.volatilityReturnWeight +
      avgStress * config.volatilityStressWeight +
      (hotShare + weakShare + limitDownShare) * config.volatilityBoardWeight +
      avgHeat * config.volatilityHeatWeight,
    18,
    92
  );

  game.market.sentiment = moveToward(game.market.sentiment, sentimentTarget, config.sentimentSpeed, 0, 100);
  game.market.liquidity = moveToward(game.market.liquidity, liquidityTarget, config.liquiditySpeed, 0, 100);
  game.market.volatility = moveToward(game.market.volatility, volatilityTarget, config.volatilitySpeed, 0, 100);
  game.market.regime = getMarketRegime(game.market.sentiment, sectorMomentum, limitDownShare, panicShare);
}

function getMarketRegime(sentiment: number, momentum: number, limitDownShare: number, panicShare: number): MarketRegime {
  const config = breadthConfig.market;
  if (sentiment >= config.bullSentimentMin && momentum >= config.bullMomentumMin && limitDownShare < config.bearLimitDownShareMin) return "bull";
  if (sentiment <= config.bearSentimentMax || limitDownShare >= config.bearLimitDownShareMin || panicShare >= config.bearPanicShareMin) return "bear";
  return "choppy";
}

function isHotBoard(stock: Stock): boolean {
  return stock.boardState === "attackingLimitUp" || stock.boardState === "weakSeal" || stock.boardState === "sealedLimitUp";
}

function isWeakBoard(stock: Stock): boolean {
  return stock.boardState === "brokenBoard" || stock.boardState === "panic" || stock.boardState === "limitDown";
}

function getDayChangePct(stock: Stock): number {
  return ((stock.price - stock.previousClose) / Math.max(0.01, stock.previousClose)) * MARKET_BEHAVIOR_CONFIG.units.percentScale;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function moveToward(current: number, target: number, speed: number, min: number, max: number): number {
  return clamp(current + (target - current) * speed, min, max);
}
