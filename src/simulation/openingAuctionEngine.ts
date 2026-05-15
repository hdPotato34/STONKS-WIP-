import { clamp, GAME_CONFIG, roundMoney } from "../game/config";
import { refreshStockOptions } from "../content/stockOptions";
import { updateValuationFromPrice } from "../game/fundamentals";
import { createRng } from "../game/rng";
import type { DailyCandle, GameState, Stock } from "../game/types";
import { resetBoardQueues, setBoardQueue } from "./boardQueueLedger";
import { getLowerLimit, getUpperLimit } from "./boardEngine";
import { MARKET_BEHAVIOR_CONFIG } from "./marketBehaviorConfig";
import { getMarketMemory } from "./marketMemory";
import { calculateOverrunFatigue, calculateWashoutAttention } from "./marketSignals";

const auctionConfig = MARKET_BEHAVIOR_CONFIG.openingAuction;

type OpeningAuctionMemory = {
  closeMovePct: number;
  return5d: number;
  return10d: number;
  upStreak: number;
  greenDays5d: number;
  drawdownFrom10dHigh: number;
  ma5Deviation: number;
  valuationGap: number;
  limitUpDays5d: number;
  limitDownDays5d: number;
  downStreak: number;
  closingBoardState: Stock["boardState"];
};

export function runOpeningAuction(game: GameState): void {
  if (game.day === 1) return;

  for (const stock of Object.values(game.stocks)) {
    if (stock.halted) continue;
    const memory = buildOpeningAuctionMemory(game, stock);
    const sector = game.sectors[stock.sector];
    const rng = createRng(`${game.rngSeed}:opening-auction:${game.day}:${stock.id}`);
    const moodShock = rng.float(auctionConfig.moodShockMin, auctionConfig.moodShockMax) + (sector.momentum / 100) * auctionConfig.sectorMomentumScale;
    const overrunFatigue = calculateOverrunFatigue(memory);
    const washoutAttention = calculateWashoutAttention(memory);
    const gapPct = applyOpeningAuctionGap(stock, rng, moodShock, overrunFatigue, washoutAttention, memory);

    stock.attention = clamp(stock.attention + Math.abs(gapPct) * auctionConfig.attentionPerGapPct, 0, 100);
    stock.heat = clamp(stock.heat + Math.abs(gapPct) * auctionConfig.heatPerGapPct, 0, GAME_CONFIG.maxStockHeat);
    stock.sentiment = clamp(stock.sentiment + gapPct * auctionConfig.sentimentPerGapPct, 0, 100);
    if (gapPct > 0) {
      stock.retail.greed = clamp(stock.retail.greed + gapPct * auctionConfig.greedPerPositiveGapPct, 0, 100);
      stock.retail.boardFaith = clamp(stock.retail.boardFaith + gapPct * auctionConfig.boardFaithPerPositiveGapPct, 0, 100);
    } else if (gapPct < 0) {
      stock.retail.fear = clamp(stock.retail.fear + Math.abs(gapPct) * auctionConfig.fearPerNegativeGapPct, 0, 100);
      stock.retail.panicSellers = clamp(stock.retail.panicSellers + Math.abs(gapPct) * auctionConfig.panicSellersPerNegativeGapPct, 0, 100);
      stock.retail.dipBuyers = clamp(stock.retail.dipBuyers + Math.abs(gapPct) * auctionConfig.dipBuyersPerNegativeGapPct, 0, 100);
    }

    if (Math.abs(gapPct) > auctionConfig.eventGapThresholdPct) {
      game.eventLog.push({
        day: game.day,
        tick: game.tick,
        type: "openingAuction",
        stockId: stock.id,
        message: `${stock.name} opens ${gapPct > 0 ? "above" : "below"} yesterday's close after the auction imbalance.`
      });
    }
  }
}

function buildOpeningAuctionMemory(game: GameState, stock: Stock): OpeningAuctionMemory {
  const previousCandle = getPreviousCandle(game, stock);
  const memory = getMarketMemory(game, stock);
  const closeMovePct = previousCandle ? percentChange(previousCandle.close, previousCandle.open) : 0;

  return {
    closeMovePct,
    return5d: memory.return5d,
    return10d: memory.return10d,
    upStreak: memory.upStreak,
    greenDays5d: memory.greenDays5d,
    drawdownFrom10dHigh: memory.drawdownFrom10dHigh,
    ma5Deviation: memory.ma5Deviation,
    valuationGap: memoryForValuation(stock),
    limitUpDays5d: memory.limitUpDays5d,
    limitDownDays5d: memory.limitDownDays5d,
    downStreak: memory.downStreak,
    closingBoardState: previousCandle?.boardState ?? stock.boardState
  };
}

function applyOpeningAuctionGap(
  stock: Stock,
  rng: ReturnType<typeof createRng>,
  moodShock: number,
  overrunFatigue: number,
  washoutAttention: number,
  memory: OpeningAuctionMemory
): number {
  const randomGap =
    rng.float(auctionConfig.randomGapWideMin, auctionConfig.randomGapWideMax) + rng.float(auctionConfig.randomGapNarrowMin, auctionConfig.randomGapNarrowMax);
  const trendContinuation = clamp(memory.closeMovePct * auctionConfig.trendContinuationWeight, auctionConfig.trendContinuationMin, auctionConfig.trendContinuationMax);
  const richFatigue =
    Math.max(0, memory.valuationGap - auctionConfig.richValuationThreshold) *
    (memory.return5d > auctionConfig.richFatigueRunThreshold ? auctionConfig.richFatigueRunWeight : auctionConfig.richFatigueBaseWeight);
  const fatigueGap =
    overrunFatigue > auctionConfig.overrunFatigueThreshold
      ? rng.chance(auctionConfig.overrunPositiveChance)
        ? rng.float(auctionConfig.overrunPositiveMin, auctionConfig.overrunPositiveMax) * overrunFatigue
        : -rng.float(auctionConfig.overrunNegativeMin, auctionConfig.overrunNegativeMax) * overrunFatigue
      : overrunFatigue * auctionConfig.overrunDefaultWeight;
  const boardCarry = getBoardCarry(rng, memory);
  const limitContinuation = getLimitContinuationGap(stock, rng, memory);
  const repeatedLimitRelief =
    memory.limitDownDays5d >= 2
      ? rng.float(auctionConfig.repeatLimitDownReliefMin, auctionConfig.repeatLimitDownReliefMax) +
        Math.max(0, -memory.drawdownFrom10dHigh - auctionConfig.repeatLimitDownDrawdownThreshold) * auctionConfig.repeatLimitDownDrawdownWeight
      : 0;
  let gapPct =
    randomGap +
      moodShock * auctionConfig.moodShockGapWeight +
      trendContinuation +
      boardCarry +
      limitContinuation +
      repeatedLimitRelief +
      fatigueGap +
      washoutAttention * (memory.closingBoardState === "limitDown" ? auctionConfig.washoutLimitDownGapWeight : auctionConfig.washoutDefaultGapWeight) -
      richFatigue * auctionConfig.richFatigueGapWeight;
  if (Math.abs(gapPct) < auctionConfig.minimumGapAbs) {
    gapPct = rng.chance(0.5)
      ? rng.float(auctionConfig.minimumGapAbs, auctionConfig.minimumGapRandomMax)
      : -rng.float(auctionConfig.minimumGapAbs, auctionConfig.minimumGapRandomMax);
  }

  const auctionPrice = roundMoney(
    clamp(stock.previousClose * (1 + gapPct / MARKET_BEHAVIOR_CONFIG.units.percentScale), getLowerLimit(stock), getUpperLimit(stock))
  );
  stock.price = auctionPrice;
  stock.open = auctionPrice;
  stock.high = auctionPrice;
  stock.low = auctionPrice;
  stock.microPrice = auctionPrice;
  stock.momentum = clamp(((auctionPrice - stock.previousClose) / Math.max(MARKET_BEHAVIOR_CONFIG.units.minPrice, stock.previousClose)) * 1000, -100, 100);
  stock.microstructure.flowMemory = clamp(
    gapPct * auctionConfig.flowMemoryPerGapPct,
    auctionConfig.flowMemoryMin,
    auctionConfig.flowMemoryMax
  );
  stock.microstructure.shockMemory = clamp(
    gapPct * auctionConfig.shockMemoryPerGapPct,
    auctionConfig.shockMemoryMin,
    auctionConfig.shockMemoryMax
  );
  stock.microstructure.lastPrintSign = gapPct > 0 ? 1 : gapPct < 0 ? -1 : 0;
  syncOpeningBoardQueue(stock, gapPct);
  updateValuationFromPrice(stock);
  refreshStockOptions(stock);
  syncOpeningPrint(stock);

  return ((auctionPrice - stock.previousClose) / Math.max(MARKET_BEHAVIOR_CONFIG.units.minPrice, stock.previousClose)) * MARKET_BEHAVIOR_CONFIG.units.percentScale;
}

function getBoardCarry(rng: ReturnType<typeof createRng>, memory: OpeningAuctionMemory): number {
  if (memory.closingBoardState === "sealedLimitUp") return rng.float(auctionConfig.sealedLimitUpCarryMin, auctionConfig.sealedLimitUpCarryMax);
  if (memory.closingBoardState === "weakSeal" || memory.closingBoardState === "attackingLimitUp") {
    return rng.float(auctionConfig.hotBoardCarryMin, auctionConfig.hotBoardCarryMax);
  }
  if (memory.closingBoardState === "limitDown") {
    return -rng.float(auctionConfig.limitDownCarryMin, memory.limitDownDays5d >= 2 ? auctionConfig.repeatLimitDownCarryMax : auctionConfig.limitDownCarryMax);
  }
  if (memory.closingBoardState === "panic" || memory.closingBoardState === "brokenBoard") {
    return -rng.float(auctionConfig.panicCarryMin, auctionConfig.panicCarryMax);
  }
  return 0;
}

function getLimitContinuationGap(stock: Stock, rng: ReturnType<typeof createRng>, memory: OpeningAuctionMemory): number {
  const config = auctionConfig.limitContinuation;
  const limitPct = getLimitRatioPct(stock);
  const heatedTape = stock.attention >= config.hotAttentionThreshold;
  const hotSector = memory.return5d > config.hotSectorMomentumThreshold || memory.greenDays5d >= 4;

  if (memory.closingBoardState === "sealedLimitUp" && (heatedTape || hotSector) && rng.chance(config.sealedLimitUpChance)) {
    return rng.float(config.sealedLimitUpMinLimitShare, config.sealedLimitUpMaxLimitShare) * limitPct;
  }

  if ((memory.closingBoardState === "weakSeal" || memory.closingBoardState === "attackingLimitUp") && (heatedTape || hotSector) && rng.chance(config.hotBoardChance)) {
    return rng.float(config.hotBoardMinLimitShare, config.hotBoardMaxLimitShare) * limitPct;
  }

  if (memory.closingBoardState === "limitDown" && rng.chance(config.limitDownChance)) {
    return -rng.float(config.limitDownMinLimitShare, config.limitDownMaxLimitShare) * limitPct;
  }

  return 0;
}

function syncOpeningBoardQueue(stock: Stock, gapPct: number): void {
  const queueShare = MARKET_BEHAVIOR_CONFIG.board.lockedBoard.limitOpenQueueShare;
  if (stock.price >= getUpperLimit(stock)) {
    stock.boardState = "sealedLimitUp";
    setBoardQueue(stock, "buy", Math.max(stock.buyQueue, stock.currentLiquidity * queueShare * Math.max(0.4, Math.abs(gapPct) / getLimitRatioPct(stock))), {
      opening: 1
    });
    setBoardQueue(stock, "sell", 0, {});
  } else if (stock.price <= getLowerLimit(stock)) {
    stock.boardState = "limitDown";
    setBoardQueue(stock, "sell", Math.max(stock.sellQueue, stock.currentLiquidity * queueShare * Math.max(0.4, Math.abs(gapPct) / getLimitRatioPct(stock))), {
      opening: 1
    });
    setBoardQueue(stock, "buy", 0, {});
  } else {
    stock.boardState = "loose";
    resetBoardQueues(stock);
  }
}

function getLimitRatioPct(stock: Stock): number {
  return ((getUpperLimit(stock) / stock.previousClose - 1) * MARKET_BEHAVIOR_CONFIG.units.percentScale);
}

function syncOpeningPrint(stock: Stock): void {
  const openingPrint = stock.chart[0];
  if (openingPrint) {
    openingPrint.price = stock.price;
    openingPrint.boardState = stock.boardState;
  }

  const candle = stock.dailyCandles.find((candidate) => candidate.day === openingPrint?.day);
  if (candle) {
    candle.open = stock.price;
    candle.high = stock.price;
    candle.low = stock.price;
    candle.close = stock.price;
  }
}

function getPreviousCandle(game: GameState, stock: Stock): DailyCandle | undefined {
  return stock.dailyCandles.filter((candle) => candle.day < game.day).at(-1);
}

function percentChange(current: number, previous: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return 0;
  return (current / previous - 1) * MARKET_BEHAVIOR_CONFIG.units.percentScale;
}

function memoryForValuation(stock: Stock): number {
  const fairValue = Math.max(MARKET_BEHAVIOR_CONFIG.units.minPrice, stock.earningsPerShare * stock.fairPe);
  return stock.price / fairValue - 1;
}
