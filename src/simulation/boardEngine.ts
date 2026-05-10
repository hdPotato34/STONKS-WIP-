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

  if (stock.price >= upperLimit) {
    const netBuy = pressure.buyPressure - pressure.sellPressure;
    if (netBuy >= 0) {
      stock.buyQueue = stock.buyQueue * 0.97 + netBuy * 0.72;
      stock.sellQueue *= 0.72;
    } else {
      const sellExcess = Math.abs(netBuy);
      stock.buyQueue = Math.max(0, stock.buyQueue * 0.9 - sellExcess * 0.45);
      stock.sellQueue = stock.sellQueue * 0.72 + sellExcess * 0.35;
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
    (previousState === "weakSeal" ? 18 : 0);
  const denominator = stock.buyQueue + pressure.sellPressure + hiddenExitRisk + 1;
  stock.boardStrength = clamp((stock.buyQueue / denominator) * 100, 0, 100);

  if (stock.price <= lowerLimit) {
    stock.boardState = "limitDown";
  } else if (
    (previousState === "sealedLimitUp" || previousState === "weakSeal") &&
    pressure.sellPressure > pressure.buyPressure * 1.25
  ) {
    stock.boardState = "brokenBoard";
  } else if ((severeDrop && pressure.sellPressure > pressure.buyPressure * 1.35) || (materialDrop && fearCanSnowball && sellImbalance)) {
    stock.boardState = "panic";
  } else if (stock.price < upperLimit && nearLimitUp) {
    stock.boardState = "attackingLimitUp";
  } else if (stock.price < upperLimit) {
    stock.boardState = "loose";
  } else if (stock.boardStrength >= 65) {
    stock.boardState = "sealedLimitUp";
  } else if (stock.boardStrength >= 35) {
    stock.boardState = "weakSeal";
  } else {
    stock.boardState = "brokenBoard";
  }

  return stock.boardState;
}

export function roundPrice(price: number): number {
  return Math.round(price * 100) / 100;
}
