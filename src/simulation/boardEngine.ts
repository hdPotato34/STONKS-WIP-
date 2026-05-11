import { clamp, GAME_CONFIG } from "../game/config";
import type { BoardState, BoardType, Pressure, Stock } from "../game/types";

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
  const dayChangePct = ((stock.price - stock.previousClose) / stock.previousClose) * 100;
  const nearLimitUp = stock.price >= stock.previousClose * (1 + limitRatio * 0.82);
  const materialDrop = dayChangePct <= -Math.max(2.5, limitRatio * 100 * 0.34);
  const severeDrop = dayChangePct <= -Math.max(4, limitRatio * 100 * 0.52);
  const fearCanSnowball = stock.retail.fear > 62 && stock.retail.panicSellers > 54;
  const sellImbalance = pressure.sellPressure > pressure.buyPressure * 2.25;
  const buyConviction = getBuyConvictionRatio(pressure);
  const queueConviction = clamp(
    buyConviction + Math.max(0, pressure.buyPressure - pressure.sellPressure) / Math.max(1, stock.currentLiquidity) * 0.24,
    0,
    1
  );

  if (stock.price >= upperLimit) {
    const netBuy = pressure.buyPressure - pressure.sellPressure;
    if (netBuy >= 0) {
      stock.buyQueue = stock.buyQueue * 0.965 + netBuy * (0.5 + queueConviction * 0.42);
      stock.sellQueue *= 0.72;
    } else {
      const sellExcess = Math.abs(netBuy);
      const queueBuffer = stock.buyQueue * (previousState === "sealedLimitUp" ? 0.34 : 0.2) * (0.85 + buyConviction);
      const unabsorbedSell = Math.max(0, sellExcess - queueBuffer);
      stock.buyQueue = Math.max(0, stock.buyQueue * 0.9 - unabsorbedSell * (0.34 + (1 - buyConviction) * 0.14));
      stock.sellQueue = stock.sellQueue * 0.72 + unabsorbedSell * (0.34 + (1 - buyConviction) * 0.1);
    }
  } else if (stock.price <= lowerLimit) {
    const netSell = pressure.sellPressure - pressure.buyPressure;
    if (netSell >= 0) {
      stock.sellQueue = stock.sellQueue * 0.95 + netSell * 0.62;
      stock.buyQueue *= 0.7;
    } else {
      const buyExcess = Math.abs(netSell);
      stock.sellQueue = Math.max(0, stock.sellQueue * 0.86 - buyExcess * 0.36);
      stock.buyQueue = stock.buyQueue * 0.72 + buyExcess * 0.44;
    }
  } else {
    stock.buyQueue *= 0.72;
    stock.sellQueue *= 0.78;
  }

  const hiddenExitRisk =
    stock.costDistribution.deepProfit * 0.4 +
    stock.costDistribution.profit * 0.25 +
    stock.heat * 0.35 +
    (previousState === "weakSeal" ? 18 : 0) +
    (stock.price >= upperLimit ? (1 - buyConviction) * 24 : 0);
  const denominator = stock.buyQueue + pressure.sellPressure + hiddenExitRisk + 1;
  stock.boardStrength = clamp((stock.buyQueue / denominator) * 100, 0, 100);
  const largeCapBoardBrake = stock.marketCap > 50_000_000_000 ? 1.9 : stock.marketCap > 10_000_000_000 ? 1.18 : 1;
  const queueIsDeep = stock.buyQueue > stock.currentLiquidity * (0.075 + (1 - buyConviction) * 0.075) * largeCapBoardBrake;
  const sealHasConviction =
    buyConviction >= (stock.marketCap > 50_000_000_000 ? 0.36 : 0.24) ||
    pressure.buyPressure > pressure.sellPressure * (stock.marketCap > 50_000_000_000 ? 2.25 : 1.6);
  const queueAbsorbsSell = stock.buyQueue > Math.max(pressure.sellPressure * 0.82, stock.currentLiquidity * 0.04);

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
  } else if (stock.boardStrength >= (stock.marketCap > 50_000_000_000 ? 76 : 66) && queueIsDeep && sealHasConviction) {
    stock.boardState = "sealedLimitUp";
  } else if (stock.boardStrength >= 36 || queueIsDeep) {
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
