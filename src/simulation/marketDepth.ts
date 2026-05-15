import { clamp, roundMoney, roundShares } from "../game/config";
import { getValuationSnapshot } from "../game/fundamentals";
import type { ExecutionFill, MarketCapClass, MarketDepth, Stock } from "../game/types";
import { consumeBoardQueue } from "./boardQueueLedger";
import { getLowerLimit, getUpperLimit, roundPrice } from "./boardEngine";
import { MARKET_BEHAVIOR_CONFIG } from "./marketBehaviorConfig";

export type DepthPressureHints = {
  buyPressure: number;
  sellPressure: number;
};

export type ExecutionConstraints = {
  limitPrice?: number;
};

const depthConfig = MARKET_BEHAVIOR_CONFIG.marketDepth;
const unitConfig = MARKET_BEHAVIOR_CONFIG.units;

export function getMarketCapClass(stock: Stock): MarketCapClass {
  if (stock.marketCap < MARKET_BEHAVIOR_CONFIG.marketCap.smallMax) return "small";
  if (stock.marketCap <= MARKET_BEHAVIOR_CONFIG.marketCap.midMax) return "mid";
  return "large";
}

export function calculateEffectiveDepth(stock: Stock): number {
  const capClass = getMarketCapClass(stock);
  const capMultiplier = depthConfig.effectiveDepth.capMultiplier[capClass];
  const floatValue = stock.floatShares * stock.price;
  const floatDepthRatio = depthConfig.effectiveDepth.floatDepthRatio[capClass];
  const floatDepthCeiling = floatValue * floatDepthRatio;

  return roundMoney(Math.max(depthConfig.minEffectiveDepth, Math.min(stock.currentLiquidity * capMultiplier, floatDepthCeiling)));
}

export function createMarketDepth(stock: Stock, hints: DepthPressureHints): MarketDepth {
  const effectiveDepth = calculateEffectiveDepth(stock);
  const capClass = getMarketCapClass(stock);
  const pressureSkew = (hints.sellPressure - hints.buyPressure) / Math.max(1, effectiveDepth);
  const upperLimit = getUpperLimit(stock);
  const lowerLimit = getLowerLimit(stock);
  const atUpperLimit = stock.price >= upperLimit;
  const atLowerLimit = stock.price <= lowerLimit;
  const valuation = getValuationSnapshot(stock);
  const undervaluation = Math.max(0, -valuation.valuationGap);
  const overvaluation = Math.max(0, valuation.valuationGap);
  const stress = stock.microstructure.liquidityStress;
  const flowMemory = stock.microstructure.flowMemory;

  const boardAskModifier =
    stock.boardState === "sealedLimitUp"
      ? depthConfig.book.sealedLimitUpAskModifier
      : stock.boardState === "weakSeal"
        ? depthConfig.book.weakSealAskModifier
        : stock.boardState === "panic" || stock.boardState === "limitDown"
          ? depthConfig.book.panicAskModifier
          : 1;
  const boardBidModifier =
    stock.boardState === "sealedLimitUp"
      ? depthConfig.book.sealedLimitUpBidModifier
      : stock.boardState === "weakSeal"
        ? depthConfig.book.weakSealBidModifier
        : stock.boardState === "panic" || stock.boardState === "limitDown"
          ? depthConfig.book.panicBidModifier
          : 1;

  let askFactor = clamp(
    (0.5 +
      stock.retail.fear / 95 +
      stock.retail.panicSellers / 150 +
      (100 - stock.retail.greed) / 260 +
      stock.institutionPresence / 700 +
      Math.max(0, pressureSkew) * 0.45) *
      boardAskModifier,
    0.03,
    2.4
  );
  let bidFactor = clamp(
    (0.45 +
      stock.retail.greed / 110 +
      stock.retail.boardFaith / 160 +
      stock.institutionPresence / 850 +
      Math.max(0, -pressureSkew) * 0.35) *
      boardBidModifier,
    0.03,
    2.2
  );

  askFactor *= clamp(1 + overvaluation * 0.28 - undervaluation * 0.22 + stress / 260 + Math.max(0, -flowMemory) / 420, 0.72, 1.75);
  bidFactor *= clamp(1 + undervaluation * 0.42 - overvaluation * 0.16 + stress / 320 + Math.max(0, flowMemory) / 520, 0.76, 1.65);

  const underBoardBid =
    effectiveDepth * bidFactor * (stock.boardState === "sealedLimitUp" ? depthConfig.book.sealedUnderBoardBidShare : depthConfig.book.underBoardBidShare);
  const overBoardAsk =
    effectiveDepth * askFactor * (stock.boardState === "limitDown" ? depthConfig.book.limitDownOverBoardAskShare : depthConfig.book.overBoardAskShare);

  if (atUpperLimit) {
    askFactor *= stock.boardState === "sealedLimitUp" ? depthConfig.book.sealedLimitUpAskModifier : depthConfig.book.limitDownOverBoardAskShare;
  }

  if (atLowerLimit) {
    askFactor *= 1.7;
  }

  const askNotional = roundMoney(atUpperLimit ? Math.max(0, stock.sellQueue) : atLowerLimit ? Math.max(0, stock.sellQueue) + overBoardAsk : effectiveDepth * askFactor);
  const bidNotional = roundMoney(atLowerLimit ? Math.max(0, stock.buyQueue) : atUpperLimit ? Math.max(0, stock.buyQueue) + underBoardBid : effectiveDepth * bidFactor);

  return {
    stockId: stock.id,
    marketCapClass: capClass,
    effectiveDepth,
    bidNotional,
    askNotional,
    askLevels: buildAskLevels(stock, askNotional),
    bidLevels: buildBidLevels(stock, bidNotional)
  };
}

export function executeBuyFromDepth(
  stock: Stock,
  depth: MarketDepth,
  requestedCash: number,
  owner: ExecutionFill["owner"],
  ownerInfo: Pick<ExecutionFill, "ownerId" | "ownerName" | "intention"> = {},
  constraints: ExecutionConstraints = {}
): ExecutionFill {
  let remainingCash = Math.max(0, requestedCash);
  let filledShares = 0;
  let filledNotional = 0;
  let finalPrice = stock.price;

  for (const level of depth.askLevels) {
    if (remainingCash <= 0) break;
    if (level.availableNotional <= 0) continue;
    if (constraints.limitPrice !== undefined && level.price > constraints.limitPrice) break;

    const levelBefore = level.availableNotional;
    const consumedCash = Math.min(remainingCash, level.availableNotional);
    const sharesAtLevel = roundShares(consumedCash / level.price);
    const notionalAtLevel = roundMoney(sharesAtLevel * level.price);
    if (sharesAtLevel <= 0 || notionalAtLevel <= 0) continue;

    level.availableNotional = roundMoney(level.availableNotional - notionalAtLevel);
    remainingCash = roundMoney(remainingCash - notionalAtLevel);
    filledShares += sharesAtLevel;
    filledNotional = roundMoney(filledNotional + notionalAtLevel);
    finalPrice = interpolateFillPrice(stock.price, level.price, notionalAtLevel / Math.max(1, levelBefore));
  }

  if (stock.price <= getLowerLimit(stock) && filledNotional > 0) {
    consumeBoardQueue(stock, "sell", filledNotional);
  }

  return buildFill({
    stock,
    owner,
    ownerInfo,
    side: "buy",
    requestedCash,
    filledShares,
    filledNotional,
    finalPrice,
    unfilledCash: remainingCash,
    unfilledShares: 0,
    depthNotional: depth.askNotional
  });
}

export function executeSellIntoDepth(
  stock: Stock,
  depth: MarketDepth,
  requestedShares: number,
  owner: ExecutionFill["owner"],
  ownerInfo: Pick<ExecutionFill, "ownerId" | "ownerName" | "intention"> = {},
  constraints: ExecutionConstraints = {}
): ExecutionFill {
  let remainingShares = roundShares(requestedShares);
  let filledShares = 0;
  let filledNotional = 0;
  let finalPrice = stock.price;

  for (const level of depth.bidLevels) {
    if (remainingShares <= 0) break;
    if (level.availableNotional <= 0) continue;
    if (constraints.limitPrice !== undefined && level.price < constraints.limitPrice) break;

    const levelBefore = level.availableNotional;
    const sharesAtLevel = Math.min(remainingShares, roundShares(level.availableNotional / level.price));
    const notionalAtLevel = roundMoney(sharesAtLevel * level.price);
    if (sharesAtLevel <= 0 || notionalAtLevel <= 0) continue;

    level.availableNotional = roundMoney(level.availableNotional - notionalAtLevel);
    remainingShares -= sharesAtLevel;
    filledShares += sharesAtLevel;
    filledNotional = roundMoney(filledNotional + notionalAtLevel);
    finalPrice = interpolateFillPrice(stock.price, level.price, notionalAtLevel / Math.max(1, levelBefore));
  }

  if (stock.price >= getUpperLimit(stock) && filledNotional > 0) {
    consumeBoardQueue(stock, "buy", filledNotional);
  }

  return buildFill({
    stock,
    owner,
    ownerInfo,
    side: "sell",
    requestedShares,
    filledShares,
    filledNotional,
    finalPrice,
    unfilledCash: 0,
    unfilledShares: remainingShares,
    depthNotional: depth.bidNotional
  });
}

function buildAskLevels(stock: Stock, totalNotional: number) {
  const upper = getUpperLimit(stock);
  const lower = getLowerLimit(stock);
  const start = stock.price;
  const lockedQueue = start <= lower ? Math.min(totalNotional, Math.max(0, stock.sellQueue)) : 0;
  const remainingNotional = Math.max(0, totalNotional - lockedQueue);
  const levelCount = getLevelCount(stock, "ask");
  const weights = buildLevelWeights(stock, "ask", levelCount);
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);

  const levels = Array.from({ length: levelCount }, (_, index) => {
    const boundaryPrice = start >= upper || index === levelCount - 1 ? upper : Math.min(upper, start + unitConfig.priceTick * (index + 1));
    const price = roundPrice(boundaryPrice);
    return {
      price: Math.max(stock.price, price),
      availableNotional: roundMoney(remainingNotional * (weights[index] / totalWeight))
    };
  });

  return lockedQueue > 0 ? [{ price: start, availableNotional: roundMoney(lockedQueue) }, ...levels] : levels;
}

function buildBidLevels(stock: Stock, totalNotional: number) {
  const upper = getUpperLimit(stock);
  const lower = getLowerLimit(stock);
  const start = stock.price;
  const lockedQueue = start >= upper ? Math.min(totalNotional, Math.max(0, stock.buyQueue)) : 0;
  const remainingNotional = Math.max(0, totalNotional - lockedQueue);
  const levelCount = getLevelCount(stock, "bid");
  const weights = buildLevelWeights(stock, "bid", levelCount);
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);

  const levels = Array.from({ length: levelCount }, (_, index) => {
    const boundaryPrice = start <= lower || index === levelCount - 1 ? lower : Math.max(lower, start - unitConfig.priceTick * (index + 1));
    const price = roundPrice(boundaryPrice);
    return {
      price: Math.min(stock.price, price),
      availableNotional: roundMoney(remainingNotional * (weights[index] / totalWeight))
    };
  });

  return lockedQueue > 0 ? [{ price: start, availableNotional: roundMoney(lockedQueue) }, ...levels] : levels;
}

function getLevelCount(stock: Stock, side: "ask" | "bid"): number {
  const upper = getUpperLimit(stock);
  const lower = getLowerLimit(stock);
  const span = side === "ask" ? Math.max(0, upper - stock.price) : Math.max(0, stock.price - lower);
  return Math.max(depthConfig.minLevelCount, Math.min(depthConfig.maxLevelCount, Math.ceil(span / unitConfig.priceTick)));
}

function buildLevelWeights(stock: Stock, side: "ask" | "bid", levelCount: number): number[] {
  const tick = stock.chart.at(-1)?.tick ?? 0;
  const turnoverBucket = Math.floor(stock.turnover / 500_000);
  const sideSeed = side === "ask" ? 17 : 31;
  const stress = stock.microstructure.liquidityStress;
  const flowMemory = stock.microstructure.flowMemory;

  return Array.from({ length: levelCount }, (_, index) => {
    const distance = index / Math.max(1, levelCount - 1);
    const nearBookBias = (1.08 + stress / 220) * Math.exp(-distance * (2.15 + stress / 90));
    const depthBias = 0.12 + distance * 0.22;
    const churn = 0.62 + pseudoNoise(`${stock.id}:${sideSeed}:${tick}:${turnoverBucket}:${index}:${Math.floor(stress)}`) * (0.52 + stress / 180);
    const crowdBias =
      side === "ask"
        ? 1 + stock.retail.fear / 360 + Math.max(0, stock.momentum) / 900
        : 1 + stock.retail.greed / 390 + Math.max(0, -stock.momentum) / 900;
    const flowBias = side === "ask" ? 1 + Math.max(0, -flowMemory) / 360 : 1 + Math.max(0, flowMemory) / 380;

    return Math.max(0.04, (nearBookBias + depthBias) * churn * crowdBias * flowBias);
  });
}

function pseudoNoise(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function interpolateFillPrice(startPrice: number, levelPrice: number, consumedLevelRatio: number): number {
  const ratio = clamp(consumedLevelRatio, 0, 1);
  return roundPrice(startPrice + (levelPrice - startPrice) * ratio);
}

function buildFill(args: {
  stock: Stock;
  owner: ExecutionFill["owner"];
  ownerInfo: Pick<ExecutionFill, "ownerId" | "ownerName" | "intention">;
  side: "buy" | "sell";
  requestedCash?: number;
  requestedShares?: number;
  filledShares: number;
  filledNotional: number;
  finalPrice: number;
  unfilledCash: number;
  unfilledShares: number;
  depthNotional: number;
}): ExecutionFill {
  return {
    owner: args.owner,
    ...args.ownerInfo,
    stockId: args.stock.id,
    side: args.side,
    requestedCash: args.requestedCash,
    requestedShares: args.requestedShares,
    filledShares: roundShares(args.filledShares),
    filledNotional: roundMoney(args.filledNotional),
    avgPrice: args.filledShares > 0 ? roundMoney(args.filledNotional / args.filledShares) : 0,
    finalPrice: args.filledShares > 0 ? args.finalPrice : args.stock.price,
    unfilledCash: roundMoney(args.unfilledCash),
    unfilledShares: roundShares(args.unfilledShares),
    liquidityTakenPct: clamp((args.filledNotional / Math.max(1, args.depthNotional)) * 100, 0, 100)
  };
}
