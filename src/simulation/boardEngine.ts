import { clamp, GAME_CONFIG } from "../game/config";
import type { BoardState, BoardType, Pressure, Stock } from "../game/types";
import {
  addBoardQueue,
  consumeBoardQueue,
  decayBoardQueue,
  getBoardQueueBufferMultiplier,
  getBoardQueueQuality,
  getQueueSourceWeightsFromPressure
} from "./boardQueueLedger";
import { MARKET_BEHAVIOR_CONFIG } from "./marketBehaviorConfig";

const boardConfig = MARKET_BEHAVIOR_CONFIG.board;

export function getLimitRatio(boardTypeOrStock: BoardType | Stock): number {
  const boardType = typeof boardTypeOrStock === "string" ? boardTypeOrStock : boardTypeOrStock.boardType;
  if (boardType === "growth") return GAME_CONFIG.growthBoardLimit;
  if (boardType === "st") return GAME_CONFIG.stBoardLimit;
  return GAME_CONFIG.mainBoardLimit;
}

export function getUpperLimit(stock: Stock): number {
  return roundPrice(stock.previousClose * (1 + getLimitRatio(stock)));
}

export function getLowerLimit(stock: Stock): number {
  return roundPrice(stock.previousClose * (1 - getLimitRatio(stock)));
}

export function updateBoardState(stock: Stock, pressure: Pressure): BoardState {
  const upperLimit = getUpperLimit(stock);
  const lowerLimit = getLowerLimit(stock);
  const previousState = stock.boardState;
  const limitRatio = getLimitRatio(stock);
  const dayChangePct = ((stock.price - stock.previousClose) / stock.previousClose) * MARKET_BEHAVIOR_CONFIG.units.percentScale;
  const nearLimitUp = stock.price >= stock.previousClose * (1 + limitRatio * boardConfig.nearLimitUpProgress);
  const materialDrop =
    dayChangePct <= -Math.max(boardConfig.materialDropPctFloor, limitRatio * MARKET_BEHAVIOR_CONFIG.units.percentScale * boardConfig.materialDropLimitScale);
  const severeDrop =
    dayChangePct <= -Math.max(boardConfig.severeDropPctFloor, limitRatio * MARKET_BEHAVIOR_CONFIG.units.percentScale * boardConfig.severeDropLimitScale);
  const fearCanSnowball = stock.retail.fear > boardConfig.fearSnowballThreshold && stock.retail.panicSellers > boardConfig.panicSellerSnowballThreshold;
  const sellImbalance = pressure.sellPressure > pressure.buyPressure * boardConfig.sellImbalanceMultiple;
  const buyConviction = getBuyConvictionRatio(pressure);
  const queueConviction = clamp(
    buyConviction + Math.max(0, pressure.buyPressure - pressure.sellPressure) / Math.max(1, stock.currentLiquidity) * 0.24,
    0,
    1
  );

  if (stock.price >= upperLimit) {
    const netBuy = pressure.buyPressure - pressure.sellPressure;
    if (netBuy >= 0) {
      decayBoardQueue(stock, "buy", 0.965);
      addBoardQueue(stock, "buy", netBuy * (0.5 + queueConviction * 0.42), getQueueSourceWeightsFromPressure(pressure, "buy"));
      decayBoardQueue(stock, "sell", 0.72);
    } else {
      const sellExcess = Math.abs(netBuy);
      const queueBuffer =
        stock.buyQueue *
        (previousState === "sealedLimitUp" ? 0.34 : 0.2) *
        (0.85 + buyConviction) *
        getBoardQueueBufferMultiplier(stock, "buy");
      const unabsorbedSell = Math.max(0, sellExcess - queueBuffer);
      decayBoardQueue(stock, "buy", 0.9);
      consumeBoardQueue(stock, "buy", unabsorbedSell * (0.34 + (1 - buyConviction) * 0.14));
      decayBoardQueue(stock, "sell", 0.72);
      addBoardQueue(stock, "sell", unabsorbedSell * (0.34 + (1 - buyConviction) * 0.1), getQueueSourceWeightsFromPressure(pressure, "sell"));
    }
  } else if (stock.price <= lowerLimit) {
    const netSell = pressure.sellPressure - pressure.buyPressure;
    if (netSell >= 0) {
      decayBoardQueue(stock, "sell", 0.95);
      addBoardQueue(stock, "sell", netSell * 0.62, getQueueSourceWeightsFromPressure(pressure, "sell"));
      decayBoardQueue(stock, "buy", 0.7);
    } else {
      const buyExcess = Math.abs(netSell);
      decayBoardQueue(stock, "sell", 0.86);
      consumeBoardQueue(stock, "sell", buyExcess * 0.36);
      decayBoardQueue(stock, "buy", 0.72);
      addBoardQueue(stock, "buy", buyExcess * 0.44, getQueueSourceWeightsFromPressure(pressure, "buy"));
    }
  } else {
    decayBoardQueue(stock, "buy", 0.72);
    decayBoardQueue(stock, "sell", 0.78);
  }

  const hiddenExitRisk =
    stock.costDistribution.deepProfit * 0.4 +
    stock.costDistribution.profit * 0.25 +
    stock.heat * 0.35 +
    (previousState === "weakSeal" ? 18 : 0) +
    (stock.price >= upperLimit ? (1 - buyConviction) * 24 : 0);
  const qualityAdjustedBuyQueue = stock.buyQueue * (0.7 + getBoardQueueQuality(stock, "buy") * 0.6);
  const denominator = qualityAdjustedBuyQueue + pressure.sellPressure + hiddenExitRisk + 1;
  stock.boardStrength = clamp((qualityAdjustedBuyQueue / denominator) * 100, 0, 100);
  const largeCapBoardBrake =
    stock.marketCap > MARKET_BEHAVIOR_CONFIG.marketCap.midMax
      ? boardConfig.largeCapBoardBrake
      : stock.marketCap > MARKET_BEHAVIOR_CONFIG.marketCap.smallMax
        ? boardConfig.midCapBoardBrake
        : boardConfig.smallCapBoardBrake;
  const queueIsDeep =
    qualityAdjustedBuyQueue >
    stock.currentLiquidity * (boardConfig.queueDepthBase + (1 - buyConviction) * boardConfig.queueDepthConvictionWeight) * largeCapBoardBrake;
  const sealHasConviction =
    buyConviction >=
      (stock.marketCap > MARKET_BEHAVIOR_CONFIG.marketCap.midMax ? boardConfig.sealConvictionLarge : boardConfig.sealConvictionDefault) ||
    pressure.buyPressure >
      pressure.sellPressure *
        (stock.marketCap > MARKET_BEHAVIOR_CONFIG.marketCap.midMax ? boardConfig.sealPressureMultipleLarge : boardConfig.sealPressureMultipleDefault);
  const queueAbsorbsSell =
    qualityAdjustedBuyQueue * getBoardQueueBufferMultiplier(stock, "buy") > Math.max(pressure.sellPressure * 0.82, stock.currentLiquidity * 0.04);

  if (stock.price <= lowerLimit) {
    stock.boardState = "limitDown";
  } else if (
    (previousState === "sealedLimitUp" || previousState === "weakSeal") &&
    pressure.sellPressure > pressure.buyPressure * (previousState === "sealedLimitUp" ? 1.55 : 1.35) &&
    !queueAbsorbsSell
  ) {
    stock.boardState = "brokenBoard";
  } else if ((severeDrop && pressure.sellPressure > pressure.buyPressure * 1.35) || (materialDrop && fearCanSnowball && sellImbalance)) {
    stock.boardState = "panic";
  } else if (stock.price < upperLimit && nearLimitUp) {
    stock.boardState = "attackingLimitUp";
  } else if (stock.price < upperLimit) {
    stock.boardState = "loose";
  } else if (
    stock.boardStrength >= (stock.marketCap > MARKET_BEHAVIOR_CONFIG.marketCap.midMax ? boardConfig.sealedStrengthLarge : boardConfig.sealedStrengthDefault) &&
    queueIsDeep &&
    sealHasConviction
  ) {
    stock.boardState = "sealedLimitUp";
  } else if (stock.boardStrength >= boardConfig.weakSealStrength || queueIsDeep) {
    stock.boardState = "weakSeal";
  } else {
    stock.boardState = "brokenBoard";
  }

  return stock.boardState;
}

function getBuyConvictionRatio(pressure: Pressure): number {
  if (pressure.buyPressure <= 0) return 0;
  const convictionBuy =
    pressure.playerBuyPressure +
    pressure.whaleBuyPressure +
    pressure.institutionBuyPressure * 0.75 +
    pressure.quantBuyPressure * 0.45 +
    pressure.collectiveBuyPressure * 0.35 +
    pressure.retailBuyPressure * 0.2;
  return clamp(convictionBuy / pressure.buyPressure, 0, 1);
}

export function roundPrice(price: number): number {
  return Math.round(price * 100) / 100;
}
