import { clamp } from "../game/config";
import type { BoardQueueLedger, BoardQueueSideLedger, BoardQueueSource, Pressure, Stock } from "../game/types";
import { MARKET_BEHAVIOR_CONFIG } from "./marketBehaviorConfig";

export type BoardQueueSide = "buy" | "sell";
export type BoardQueueSourceWeights = Partial<Record<BoardQueueSource, number>>;

const ledgerConfig = MARKET_BEHAVIOR_CONFIG.board.queueLedger;

export function createEmptyBoardQueueLedger(): BoardQueueLedger {
  return {
    buy: createEmptySideLedger(),
    sell: createEmptySideLedger()
  };
}

export function addBoardQueue(stock: Stock, side: BoardQueueSide, notional: number, sourceWeights: BoardQueueSourceWeights): void {
  const amount = roundMoney(Math.max(0, notional));
  if (amount <= 0) return;

  const ledger = ensureBoardQueueLedger(stock)[side];
  const previousQueue = getQueueNotional(stock, side);
  const addedQuality = calculateSourceQuality(sourceWeights);
  const totalQueue = previousQueue + amount;

  setQueueNotional(stock, side, totalQueue);
  ledger.quality = clamp(
    previousQueue > 0 ? (getEffectiveQuality(ledger, previousQueue) * previousQueue + addedQuality * amount) / totalQueue : addedQuality,
    ledgerConfig.qualityMin,
    ledgerConfig.qualityMax
  );
  ledger.dominantSource = getDominantSource(sourceWeights, ledger.dominantSource);
  ledger.addedNotional = roundMoney(ledger.addedNotional + amount);
}

export function setBoardQueue(stock: Stock, side: BoardQueueSide, notional: number, sourceWeights: BoardQueueSourceWeights): void {
  const amount = roundMoney(Math.max(0, notional));
  const ledger = ensureBoardQueueLedger(stock)[side];
  setQueueNotional(stock, side, amount);
  ledger.quality = amount > 0 ? calculateSourceQuality(sourceWeights) : ledgerConfig.emptyQuality;
  ledger.dominantSource = amount > 0 ? getDominantSource(sourceWeights, "mixed") : "mixed";
  ledger.addedNotional = amount;
  ledger.consumedNotional = 0;
  ledger.lockedTicks = 0;
  ledger.openedTicks = 0;
}

export function consumeBoardQueue(stock: Stock, side: BoardQueueSide, notional: number): number {
  const amount = roundMoney(Math.max(0, notional));
  if (amount <= 0) return 0;

  const ledger = ensureBoardQueueLedger(stock)[side];
  const previousQueue = getQueueNotional(stock, side);
  const consumed = Math.min(previousQueue, amount);
  if (consumed <= 0) return 0;

  setQueueNotional(stock, side, previousQueue - consumed);
  const consumeShare = consumed / Math.max(1, previousQueue);
  ledger.quality = clamp(ledger.quality - consumeShare * ledgerConfig.consumeQualityPenalty, ledgerConfig.qualityMin, ledgerConfig.qualityMax);
  ledger.consumedNotional = roundMoney(ledger.consumedNotional + consumed);
  if (getQueueNotional(stock, side) <= 0) clearSideLedger(ledger);
  return consumed;
}

export function decayBoardQueue(stock: Stock, side: BoardQueueSide, multiplier: number): void {
  const ledger = ensureBoardQueueLedger(stock)[side];
  const previousQueue = getQueueNotional(stock, side);
  if (previousQueue <= 0) {
    clearSideLedger(ledger);
    return;
  }

  const kept = roundMoney(previousQueue * clamp(multiplier, 0, 1));
  setQueueNotional(stock, side, kept);
  if (kept <= 0) {
    clearSideLedger(ledger);
    return;
  }

  const decayShare = 1 - kept / previousQueue;
  ledger.quality = clamp(ledger.quality - decayShare * ledgerConfig.passiveDecayQualityPenalty, ledgerConfig.qualityMin, ledgerConfig.qualityMax);
}

export function resetBoardQueues(stock: Stock): void {
  stock.buyQueue = 0;
  stock.sellQueue = 0;
  stock.boardQueueLedger = createEmptyBoardQueueLedger();
}

export function recordBoardQueueLockTick(stock: Stock, side: BoardQueueSide): void {
  const ledger = ensureBoardQueueLedger(stock)[side];
  if (getQueueNotional(stock, side) <= 0) return;
  ledger.lockedTicks += 1;
  ledger.quality = clamp(ledger.quality + ledgerConfig.lockedTickQualityBonus, ledgerConfig.qualityMin, ledgerConfig.qualityMax);
}

export function recordBoardQueueOpenTick(stock: Stock, side: BoardQueueSide): void {
  const ledger = ensureBoardQueueLedger(stock)[side];
  if (getQueueNotional(stock, side) <= 0) return;
  ledger.openedTicks += 1;
  ledger.quality = clamp(ledger.quality - ledgerConfig.openedTickQualityPenalty, ledgerConfig.qualityMin, ledgerConfig.qualityMax);
}

export function getBoardQueueQuality(stock: Stock, side: BoardQueueSide): number {
  const ledger = ensureBoardQueueLedger(stock)[side];
  return getEffectiveQuality(ledger, getQueueNotional(stock, side));
}

export function getBoardQueueBufferMultiplier(stock: Stock, side: BoardQueueSide): number {
  const quality = getBoardQueueQuality(stock, side);
  const span = ledgerConfig.qualityBufferMax - ledgerConfig.qualityBufferMin;
  return ledgerConfig.qualityBufferMin + quality * span;
}

export function getQueueSourceWeightsFromPressure(pressure: Pressure, side: BoardQueueSide): BoardQueueSourceWeights {
  if (side === "buy") {
    return {
      player: pressure.playerBuyPressure,
      whale: pressure.whaleBuyPressure,
      institution: pressure.institutionBuyPressure,
      quant: pressure.quantBuyPressure,
      shrimp: pressure.collectiveBuyPressure,
      retail: pressure.retailBuyPressure,
      fundamental: pressure.fundamentalBuyPressure,
      news: pressure.newsBuyPressure,
      noise: Math.max(0, pressure.noise)
    };
  }

  return {
    player: pressure.playerSellPressure,
    whale: pressure.whaleSellPressure,
    institution: pressure.institutionSellPressure,
    quant: pressure.quantSellPressure,
    shrimp: pressure.collectiveSellPressure,
    retail: pressure.retailSellPressure,
    fundamental: pressure.fundamentalSellPressure,
    news: pressure.newsSellPressure,
    noise: Math.max(0, -pressure.noise)
  };
}

function ensureBoardQueueLedger(stock: Stock): BoardQueueLedger {
  if (!stock.boardQueueLedger) {
    stock.boardQueueLedger = createEmptyBoardQueueLedger();
  }
  return stock.boardQueueLedger;
}

function createEmptySideLedger(): BoardQueueSideLedger {
  return {
    quality: 0,
    dominantSource: "mixed",
    addedNotional: 0,
    consumedNotional: 0,
    lockedTicks: 0,
    openedTicks: 0
  };
}

function clearSideLedger(ledger: BoardQueueSideLedger): void {
  ledger.quality = 0;
  ledger.dominantSource = "mixed";
  ledger.addedNotional = 0;
  ledger.consumedNotional = 0;
  ledger.lockedTicks = 0;
  ledger.openedTicks = 0;
}

function getEffectiveQuality(ledger: BoardQueueSideLedger, queueNotional: number): number {
  if (queueNotional <= 0) return ledgerConfig.emptyQuality;
  return ledger.quality > 0 ? ledger.quality : ledgerConfig.fallbackQuality;
}

function calculateSourceQuality(weights: BoardQueueSourceWeights): number {
  let totalWeight = 0;
  let weightedQuality = 0;

  for (const [source, rawWeight] of Object.entries(weights) as Array<[BoardQueueSource, number | undefined]>) {
    const weight = Math.max(0, rawWeight ?? 0);
    if (weight <= 0) continue;
    totalWeight += weight;
    weightedQuality += weight * ledgerConfig.sourceQuality[source];
  }

  if (totalWeight <= 0) return ledgerConfig.fallbackQuality;
  return clamp(weightedQuality / totalWeight, ledgerConfig.qualityMin, ledgerConfig.qualityMax);
}

function getDominantSource(weights: BoardQueueSourceWeights, fallback: BoardQueueSource): BoardQueueSource {
  let bestSource = fallback;
  let bestWeight = 0;
  for (const [source, rawWeight] of Object.entries(weights) as Array<[BoardQueueSource, number | undefined]>) {
    const weight = Math.max(0, rawWeight ?? 0);
    if (weight > bestWeight) {
      bestSource = source;
      bestWeight = weight;
    }
  }
  return bestSource;
}

function getQueueNotional(stock: Stock, side: BoardQueueSide): number {
  return side === "buy" ? stock.buyQueue : stock.sellQueue;
}

function setQueueNotional(stock: Stock, side: BoardQueueSide, notional: number): void {
  const rounded = roundMoney(Math.max(0, notional));
  if (side === "buy") {
    stock.buyQueue = rounded;
  } else {
    stock.sellQueue = rounded;
  }
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
