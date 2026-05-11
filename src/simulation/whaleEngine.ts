import { GAME_CONFIG, roundMoney, roundShares } from "../game/config";
import { getValuationSnapshot } from "../game/fundamentals";
import { createRng } from "../game/rng";
import type { ExecutionFill, GameState, MarketCapClass, MarketDepth, Stock, Whale, WhaleIntention } from "../game/types";
import {
  calculateEffectiveDepth,
  executeBuyFromDepth,
  executeSellIntoDepth,
  getMarketCapClass
} from "./marketDepth";
import { getMarketMemory, type MarketMemorySnapshot } from "./marketMemory";
import { applyExecutionPrice } from "./priceEngine";
import { getWhalePositionPnlPct, markWhaleToMarket, recordWhaleBuy, recordWhaleSell } from "./whaleAccounting";

export type WhaleOrder = {
  whale: Whale;
  stock: Stock;
  side: "buy" | "sell";
  intention: WhaleIntention;
  requestedCash?: number;
  requestedShares?: number;
};

export function createWhaleOrders(game: GameState, stock: Stock, playerVisibility: number, effectiveDepth: number): WhaleOrder[] {
  const orders: WhaleOrder[] = [];
  const capClass = getMarketCapClass(stock);

  for (const whale of game.whales) {
    if (isWhaleOnCooldown(game, whale)) continue;
    if (!isBestWhaleOpportunity(game, stock, whale, playerVisibility)) {
      if (whale.targetStockId === stock.id) whale.intention = "idle";
      continue;
    }

    const order = createWhaleOrder(game, stock, whale, capClass, playerVisibility, effectiveDepth);
    if (order) {
      whale.targetStockId = stock.id;
      whale.intention = order.intention;
      whale.nextActionTick = getAbsoluteTick(game) + getWhaleCooldown(whale, order.intention);
      orders.push(order);
    } else if (whale.targetStockId === stock.id) {
      whale.intention = "idle";
    }
  }

  return orders;
}

export function executeWhaleOrders(game: GameState, depth: MarketDepth, orders: WhaleOrder[]): ExecutionFill[] {
  const fills: ExecutionFill[] = [];

  for (const order of orders) {
    if (order.side === "buy") {
      const requestedCash = Math.min(order.whale.cash, Math.max(0, order.requestedCash ?? 0));
      const fill = executeBuyFromDepth(order.stock, depth, requestedCash, "whale", {
        ownerId: order.whale.id,
        ownerName: order.whale.name,
        intention: order.intention
      });

      if (fill.filledShares > 0) {
        applyExecutionPrice(order.stock, fill.finalPrice);
        order.whale.cash = roundMoney(order.whale.cash - fill.filledNotional);
        recordWhaleBuy(order.whale, order.stock, fill);
        markWhaleToMarket(order.whale, game.stocks);
        recordBuyFillForWhale(order.stock, fill);
        fills.push(fill);
        appendWhaleEvent(game, order.stock, fill);
      }
    } else {
      const position = order.whale.positions[order.stock.id] ?? 0;
      const requestedShares = Math.min(position, roundShares(order.requestedShares ?? 0));
      const fill = executeSellIntoDepth(order.stock, depth, requestedShares, "whale", {
        ownerId: order.whale.id,
        ownerName: order.whale.name,
        intention: order.intention
      });

      if (fill.filledShares > 0) {
        applyExecutionPrice(order.stock, fill.finalPrice);
        order.whale.cash = roundMoney(order.whale.cash + fill.filledNotional);
        recordWhaleSell(order.whale, order.stock, fill);
        markWhaleToMarket(order.whale, game.stocks);
        recordSellFillForWhale(order.stock, fill);
        fills.push(fill);
        appendWhaleEvent(game, order.stock, fill);
      }
    }
  }

  return fills;
}

function createWhaleOrder(
  game: GameState,
  stock: Stock,
  whale: Whale,
  capClass: MarketCapClass,
  playerVisibility: number,
  effectiveDepth: number
): WhaleOrder | undefined {
  const likesSector = whale.preferredSectors.includes(stock.sector);
  const likesCap = whale.preferredCaps.includes(capClass);
  const position = whale.positions[stock.id] ?? 0;
  const positionPnlPct = getWhalePositionPnlPct(whale, stock);
  const valuation = getValuationSnapshot(stock);
  const memory = getMarketMemory(game, stock);
  const dayChangePct = ((stock.price - stock.previousClose) / stock.previousClose) * 100;
  const runnerExhaustion = getRunnerExhaustion(stock, memory, valuation.valuationGap);
  const gapFadeRisk = Math.max(0, -memory.openingGapPct - 0.7) * Math.max(0, memory.openToNowPct - 0.8) * 2.1;
  const staircaseRisk = memory.return5d > 13 || memory.upStreak >= 4 || memory.ma5Deviation > 8;
  const overextended = stock.price > stock.avgHolderCost * 1.08 || valuation.valuationGap > 0.34 || staircaseRisk;
  const veryOverextended = stock.price > stock.avgHolderCost * 1.18 || valuation.valuationGap > 0.66 || memory.return5d > 19 || memory.upStreak >= 5;
  const profitableExit =
    positionPnlPct > 0.07 ||
    valuation.valuationGap > 0.5 ||
    (positionPnlPct > 0.025 && staircaseRisk) ||
    (positionPnlPct > 0.01 && runnerExhaustion > 28) ||
    gapFadeRisk > 18;
  const losingPosition = position > 0 && positionPnlPct < -0.06;
  const stopLossRisk =
    losingPosition &&
    (stock.financialHealth < 38 ||
      stock.boardState === "limitDown" ||
      (stock.boardState === "panic" && memory.downStreak >= 2) ||
      memory.downStreak >= 3 ||
      memory.lastTickMovePct < -0.45 ||
      valuation.valuationGap > 0.22);
  const deeplyDiscounted = stock.price < stock.avgHolderCost * 0.94 || valuation.valuationGap < -0.18;
  const panicDip =
    stock.boardState === "panic" ||
    stock.boardState === "limitDown" ||
    (dayChangePct <= -3.2 && stock.retail.fear > 52) ||
    (memory.drawdownFrom10dHigh < -11 && memory.lastTickMovePct > 0.18) ||
    (stock.retail.fear > 74 && stock.retail.panicSellers > 62);
  const hotSector = game.sectors[stock.sector].attention > 52 || game.sectors[stock.sector].momentum > 8;
  const fragileBoard = stock.boardState === "weakSeal" || stock.boardState === "brokenBoard" || stock.boardState === "attackingLimitUp";
  const campaignOrder = createCampaignOrder(game, stock, whale, capClass, effectiveDepth, {
    likesSector,
    likesCap,
    position,
    positionPnlPct,
    valuationGap: valuation.valuationGap,
    dayChangePct,
    panicDip,
    hotSector,
    memory
  });
  if (campaignOrder || whale.campaign?.stockId === stock.id) return campaignOrder;
  if (whale.campaign && whale.campaign.stockId !== stock.id) return undefined;

  if (
    position > 0 &&
    (runnerExhaustion > 30 || gapFadeRisk > 16) &&
    (profitableExit || positionPnlPct > -0.01) &&
    (whale.archetype === "quantKnife" ||
      whale.archetype === "valueWall" ||
      whale.archetype === "rescueWhale" ||
      whale.archetype === "sectorRotator" ||
      whale.archetype === "liquidityVulture" ||
      whale.archetype === "bagholderWhale")
  ) {
    const requestedShares = getWhaleSellShares(
      stock,
      position,
      effectiveDepth,
      0.078 + Math.min(0.075, (runnerExhaustion + gapFadeRisk) / 900) + whale.aggression / 3_200,
      dayChangePct,
      valuation.valuationGap,
      positionPnlPct
    );
    const intention: WhaleIntention =
      whale.archetype === "quantKnife" ? "attack" : whale.archetype === "sectorRotator" ? "rotate" : "dump";
    return requestedShares > 0 ? { whale, stock, side: "sell", intention, requestedShares } : undefined;
  }

  if (whale.archetype === "pumpLord" && likesSector && likesCap) {
    if (position > 0 && ((profitableExit && (stock.heat > whale.heatTolerance || stock.boardState === "sealedLimitUp" || overextended)) || stopLossRisk)) {
      const requestedShares = getWhaleSellShares(stock, position, effectiveDepth, 0.11, dayChangePct, valuation.valuationGap, positionPnlPct);
      return requestedShares > 0 ? { whale, stock, side: "sell", intention: "dump", requestedShares } : undefined;
    }

    if (stock.attention < 54 && stock.heat < whale.heatTolerance * 0.72 && stock.momentum < 10 && valuation.valuationGap < 0.42 && !staircaseRisk) {
      const requestedCash = getWhaleBuyCash(whale, stock, effectiveDepth, 0.012, 0.075, valuation.valuationGap);
      return requestedCash > 500_000 ? { whale, stock, side: "buy", intention: "accumulate", requestedCash } : undefined;
    }

    if (stock.attention >= 55 && stock.heat < whale.heatTolerance && valuation.valuationGap < 0.72 && memory.upStreak < 5) {
      const requestedCash = getWhaleBuyCash(whale, stock, effectiveDepth, 0.014, 0.08 + whale.aggression / 1_400, valuation.valuationGap);
      return requestedCash > 500_000 ? { whale, stock, side: "buy", intention: "pump", requestedCash } : undefined;
    }
  }

  if (whale.archetype === "quantKnife" && (likesSector || runnerExhaustion > 18 || gapFadeRisk > 12 || position > 0)) {
    if (
      position > 0 &&
      ((profitableExit && (fragileBoard || veryOverextended || playerVisibility > 30 || stock.heat > whale.heatTolerance || memory.upStreak >= 4)) ||
        stopLossRisk ||
        runnerExhaustion > 24 ||
        gapFadeRisk > 16)
    ) {
      const requestedShares = getWhaleSellShares(
        stock,
        position,
        effectiveDepth,
        0.065 + whale.aggression / 1_500,
        dayChangePct,
        valuation.valuationGap,
        positionPnlPct
      );
      return requestedShares > 0 ? { whale, stock, side: "sell", intention: "attack", requestedShares } : undefined;
    }

    if (panicDip && stock.financialHealth > 48 && stock.heat < 75 && valuation.valuationGap < 0.12 && stock.microstructure.flowMemory > -18) {
      const requestedCash = getWhaleBuyCash(whale, stock, effectiveDepth, 0.012, 0.08, valuation.valuationGap);
      return requestedCash > 500_000 ? { whale, stock, side: "buy", intention: "scoop", requestedCash } : undefined;
    }
  }

  if (whale.archetype === "valueWall" && ((likesSector && likesCap) || (position > 0 && runnerExhaustion > 24))) {
    if (position > 0 && ((profitableExit && (overextended || stock.retail.greed > 68)) || stopLossRisk)) {
      const requestedShares = getWhaleSellShares(stock, position, effectiveDepth, 0.08, dayChangePct, valuation.valuationGap, positionPnlPct);
      return requestedShares > 0 ? { whale, stock, side: "sell", intention: "dump", requestedShares } : undefined;
    }

    if (deeplyDiscounted && stock.financialHealth > 58 && stock.retail.fear > 38 && (dayChangePct < -1.5 || memory.drawdownFrom10dHigh < -8)) {
      const requestedCash = getWhaleBuyCash(whale, stock, effectiveDepth, 0.014, 0.1, valuation.valuationGap);
      return requestedCash > 500_000 ? { whale, stock, side: "buy", intention: "accumulate", requestedCash } : undefined;
    }
  }

  if (whale.archetype === "bagholderWhale" && likesSector && likesCap) {
    if (position > 0 && ((positionPnlPct > -0.02 && (stock.retail.greed > 52 || playerVisibility > 35 || stock.boardState === "sealedLimitUp")) || stopLossRisk)) {
      const requestedShares = getWhaleSellShares(stock, position, effectiveDepth, 0.12, dayChangePct, valuation.valuationGap, positionPnlPct);
      return requestedShares > 0 ? { whale, stock, side: "sell", intention: "dump", requestedShares } : undefined;
    }

    if (position > 0 && stock.boardState === "weakSeal" && stock.boardStrength < 50 && whale.cash > 1_000_000 && !stopLossRisk) {
      const requestedCash = getWhaleBuyCash(whale, stock, effectiveDepth, 0.008, 0.055, valuation.valuationGap);
      return requestedCash > 500_000 ? { whale, stock, side: "buy", intention: "defend", requestedCash } : undefined;
    }
  }

  if (whale.archetype === "rescueWhale" && likesSector && capClass === "large") {
    if ((game.market.sentiment < 44 || panicDip || stock.momentum < -28 || memory.drawdownFrom10dHigh < -12) && valuation.valuationGap < 0.18) {
      const requestedCash = getWhaleBuyCash(whale, stock, effectiveDepth, 0.014, 0.12, valuation.valuationGap);
      return requestedCash > 500_000 ? { whale, stock, side: "buy", intention: "defend", requestedCash } : undefined;
    }

    if (position > 0 && profitableExit && stock.momentum > 24 && stock.retail.greed > 62 && valuation.valuationGap > 0.08) {
      const requestedShares = getWhaleSellShares(stock, position, effectiveDepth, 0.05, dayChangePct, valuation.valuationGap, positionPnlPct);
      return requestedShares > 0 ? { whale, stock, side: "sell", intention: "dump", requestedShares } : undefined;
    }
  }

  if (whale.archetype === "sectorRotator" && (likesCap || (position > 0 && runnerExhaustion > 24))) {
    if (likesSector && hotSector && stock.heat < whale.heatTolerance && stock.boardState !== "limitDown" && valuation.valuationGap < 0.38 && memory.upStreak < 4) {
      const requestedCash = getWhaleBuyCash(whale, stock, effectiveDepth, 0.011, 0.075, valuation.valuationGap);
      return requestedCash > 500_000 ? { whale, stock, side: "buy", intention: "rotate", requestedCash } : undefined;
    }

    if (
      position > 0 &&
      ((profitableExit && (!hotSector || stock.heat > whale.heatTolerance || stock.momentum < -10 || memory.upStreak >= 4 || runnerExhaustion > 24)) ||
        stopLossRisk)
    ) {
      const requestedShares = getWhaleSellShares(stock, position, effectiveDepth, 0.075, dayChangePct, valuation.valuationGap, positionPnlPct);
      return requestedShares > 0 ? { whale, stock, side: "sell", intention: "rotate", requestedShares } : undefined;
    }
  }

  if (whale.archetype === "liquidityVulture" && ((likesSector && likesCap) || (position > 0 && runnerExhaustion > 26))) {
    if (panicDip && stock.heat < 80 && valuation.valuationGap < 0.18 && (stock.microstructure.flowMemory > -22 || memory.drawdownFrom10dHigh < -14)) {
      const requestedCash = getWhaleBuyCash(whale, stock, effectiveDepth, 0.016, 0.1, valuation.valuationGap);
      return requestedCash > 500_000 ? { whale, stock, side: "buy", intention: "scoop", requestedCash } : undefined;
    }

    if (position > 0 && ((positionPnlPct > 0.04 && (stock.momentum > 14 || stock.retail.greed > 56 || playerVisibility > 30)) || stopLossRisk)) {
      const requestedShares = getWhaleSellShares(stock, position, effectiveDepth, 0.1, dayChangePct, valuation.valuationGap, positionPnlPct);
      return requestedShares > 0 ? { whale, stock, side: "sell", intention: "dump", requestedShares } : undefined;
    }
  }

  const probeOrder = createOpportunisticProbeOrder(game, stock, whale, effectiveDepth, {
    likesSector,
    likesCap,
    position,
    positionPnlPct,
    valuationGap: valuation.valuationGap,
    dayChangePct,
    memory,
    runnerExhaustion,
    gapFadeRisk
  });
  if (probeOrder) return probeOrder;

  return undefined;
}

function createOpportunisticProbeOrder(
  game: GameState,
  stock: Stock,
  whale: Whale,
  effectiveDepth: number,
  context: {
    likesSector: boolean;
    likesCap: boolean;
    position: number;
    positionPnlPct: number;
    valuationGap: number;
    dayChangePct: number;
    memory: MarketMemorySnapshot;
    runnerExhaustion: number;
    gapFadeRisk: number;
  }
): WhaleOrder | undefined {
  const tapeIsInteresting =
    Math.abs(context.memory.openingGapPct) > 1.15 ||
    Math.abs(context.memory.openToNowPct) > 2.2 ||
    Math.abs(context.memory.lastTickMovePct) > 0.36 ||
    context.memory.return5d > 8 ||
    context.memory.drawdownFrom10dHigh < -8 ||
    stock.attention > 68;
  if (!tapeIsInteresting) return undefined;

  const rng = createRng(`${game.rngSeed}:whale-probe:${game.day}:${game.tick}:${whale.id}:${stock.id}`);
  const familiarity = context.likesSector || context.likesCap || context.position > 0;
  const chance = (familiarity ? 0.13 : 0.045) + whale.aggression / 1_400 + Math.min(0.08, Math.abs(context.memory.openingGapPct) / 70);
  if (!rng.chance(chance)) return undefined;

  if (
    context.position > 0 &&
    (context.valuationGap > 0.18 ||
      context.runnerExhaustion > 16 ||
      context.gapFadeRisk > 8 ||
      (context.memory.openToNowPct > 1.8 && context.dayChangePct > 1.2) ||
      context.positionPnlPct > 0.035)
  ) {
    const requestedShares = getWhaleSellShares(
      stock,
      context.position,
      effectiveDepth,
      0.024 + whale.aggression / 5_000,
      context.dayChangePct,
      context.valuationGap,
      context.positionPnlPct
    );
    return requestedShares > 0 ? { whale, stock, side: "sell", intention: whale.archetype === "sectorRotator" ? "rotate" : "dump", requestedShares } : undefined;
  }

  if (
    whale.cash > 2_000_000 &&
    familiarity &&
    stock.boardState !== "sealedLimitUp" &&
    stock.boardState !== "limitDown" &&
    context.valuationGap < 0.24 &&
    (context.memory.openingGapPct < -0.8 || context.memory.drawdownFrom10dHigh < -7 || stock.microstructure.flowMemory > 5)
  ) {
    const requestedCash = getWhaleBuyCash(whale, stock, effectiveDepth, 0.0045, 0.032, context.valuationGap);
    return requestedCash > 350_000 ? { whale, stock, side: "buy", intention: "scoop", requestedCash } : undefined;
  }

  return undefined;
}

function createCampaignOrder(
  game: GameState,
  stock: Stock,
  whale: Whale,
  capClass: MarketCapClass,
  effectiveDepth: number,
  context: {
    likesSector: boolean;
    likesCap: boolean;
    position: number;
    positionPnlPct: number;
    valuationGap: number;
    dayChangePct: number;
    panicDip: boolean;
    hotSector: boolean;
    memory: MarketMemorySnapshot;
  }
): WhaleOrder | undefined {
  if (!whale.campaign) {
    maybeStartCampaign(game, stock, whale, capClass, effectiveDepth, context);
  }

  if (!whale.campaign || whale.campaign.stockId !== stock.id) return undefined;

  const age = getAbsoluteTick(game) - whale.campaign.startedTick;
  const phaseAge = getAbsoluteTick(game) - whale.campaign.phaseStartedTick;
  const inventoryValue = context.position * stock.price;

  if (age > 160 || (context.position <= 0 && whale.campaign.phase === "distribute" && phaseAge > 24 && context.dayChangePct > -2)) {
    whale.campaign = undefined;
    return undefined;
  }

  if (whale.campaign.phase === "accumulate") {
    if (inventoryValue >= whale.campaign.targetInventoryValue * 0.65 || phaseAge >= 14) {
      setCampaignPhase(game, whale, "shakeout");
      return undefined;
    }

    if (stock.price < getCampaignMaxEntryPrice(stock, context.valuationGap) && stock.boardState !== "sealedLimitUp") {
      const requestedCash = getWhaleBuyCash(whale, stock, effectiveDepth, 0.018, 0.12, context.valuationGap);
      return requestedCash > 500_000 ? { whale, stock, side: "buy", intention: "accumulate", requestedCash } : undefined;
    }
  }

  if (whale.campaign.phase === "shakeout") {
    setCampaignPhase(game, whale, "markUp");
    if (context.position > 0 && stock.boardState !== "limitDown" && context.dayChangePct > -7) {
      const requestedShares = getWhaleSellShares(stock, context.position, effectiveDepth, 0.028, context.dayChangePct, context.valuationGap, context.positionPnlPct);
      return requestedShares > 0 ? { whale, stock, side: "sell", intention: "attack", requestedShares } : undefined;
    }
    return undefined;
  }

  if (whale.campaign.phase === "markUp") {
    setCampaignPhase(game, whale, "distribute");
    if (stock.boardState !== "limitDown" && stock.heat < whale.heatTolerance + 18) {
      const depthPct = whale.archetype === "pumpLord" ? 1.65 : 1.15;
      const cashPct = whale.archetype === "pumpLord" ? 0.16 : 0.09;
      const requestedCash = getWhaleBuyCash(whale, stock, effectiveDepth, cashPct, depthPct, context.valuationGap);
      return requestedCash > 750_000 ? { whale, stock, side: "buy", intention: "pump", requestedCash } : undefined;
    }
  }

  if (whale.campaign.phase === "distribute") {
    if (context.positionPnlPct > 0.05 && (stock.retail.greed > 55 || stock.boardState === "sealedLimitUp" || stock.boardState === "attackingLimitUp")) {
      const requestedShares = getWhaleSellShares(stock, context.position, effectiveDepth, 0.11, context.dayChangePct, context.valuationGap, context.positionPnlPct);
      return requestedShares > 0 ? { whale, stock, side: "sell", intention: "dump", requestedShares } : undefined;
    }

    if ((context.dayChangePct < -4.2 || context.memory.drawdownFrom10dHigh < -11) && context.valuationGap < 0.16 && whale.cash > 2_000_000) {
      setCampaignPhase(game, whale, "accumulate");
    }
  }

  return undefined;
}

function maybeStartCampaign(
  game: GameState,
  stock: Stock,
  whale: Whale,
  capClass: MarketCapClass,
  effectiveDepth: number,
  context: {
    likesSector: boolean;
    likesCap: boolean;
    position: number;
    positionPnlPct: number;
    valuationGap: number;
    dayChangePct: number;
    panicDip: boolean;
    hotSector: boolean;
    memory: MarketMemorySnapshot;
  }
): void {
  if (!context.likesSector || !context.likesCap || capClass === "large") return;
  if (whale.archetype !== "pumpLord" && whale.archetype !== "bagholderWhale" && whale.archetype !== "liquidityVulture") return;
  if (stock.heat > whale.heatTolerance + 22 || stock.boardState === "sealedLimitUp" || context.memory.upStreak >= 5) return;

  const rng = createRng(`${game.rngSeed}:campaign:${game.day}:${game.tick}:${whale.id}:${stock.id}`);
  const storySetup =
    stock.attention * 0.32 +
    game.sectors[stock.sector].attention * 0.2 +
    stock.retail.gamblers * 0.14 +
    Math.max(0, game.sectors[stock.sector].momentum) * 1.1;
  const washoutSetup =
    Math.max(0, -context.dayChangePct - 3) * 6 +
    Math.max(0, -context.memory.drawdownFrom10dHigh - 8) * 1.4 +
    Math.max(0, -context.valuationGap) * 44 +
    stock.retail.dipBuyers * 0.22;
  const hasInventory = context.position * stock.price > effectiveDepth * 0.2;
  const canStart = storySetup > 48 || washoutSetup > 34 || hasInventory;
  const chance = whale.archetype === "pumpLord" ? 0.12 : whale.archetype === "liquidityVulture" ? 0.08 : 0.06;
  if (!canStart || !rng.chance(chance)) return;

  whale.campaign = {
    stockId: stock.id,
    phase: hasInventory && context.positionPnlPct > 0.04 ? "markUp" : "accumulate",
    startedDay: game.day,
    startedTick: getAbsoluteTick(game),
    phaseStartedTick: getAbsoluteTick(game),
    targetInventoryValue: Math.max(effectiveDepth * rng.float(0.5, 1.1), stock.currentLiquidity * 0.22),
    note: context.panicDip ? "washout reversal campaign" : context.hotSector ? "theme board campaign" : "inventory campaign"
  };
}

function isBestWhaleOpportunity(game: GameState, stock: Stock, whale: Whale, playerVisibility: number): boolean {
  if (whale.campaign) return whale.campaign.stockId === stock.id;

  const currentScore = scoreWhaleOpportunity(game, stock, whale, playerVisibility);
  if (currentScore <= 0) return false;
  let bestScore = currentScore;
  for (const candidate of Object.values(game.stocks)) {
    if (candidate.id === stock.id || candidate.halted) continue;
    bestScore = Math.max(bestScore, scoreWhaleOpportunity(game, candidate, whale, 0));
  }
  if (currentScore >= bestScore) return true;

  const nearBest = currentScore >= bestScore * 0.78 && currentScore > 22;
  const compelling = currentScore > 42;
  if (!nearBest && !compelling) return false;

  const rng = createRng(`${game.rngSeed}:whale-opportunity:${game.day}:${game.tick}:${whale.id}:${stock.id}`);
  return rng.chance(compelling ? 0.34 : 0.18);
}

function scoreWhaleOpportunity(game: GameState, stock: Stock, whale: Whale, playerVisibility: number): number {
  const capClass = getMarketCapClass(stock);
  const likesSector = whale.preferredSectors.includes(stock.sector);
  const likesCap = whale.preferredCaps.includes(capClass);
  const position = whale.positions[stock.id] ?? 0;
  const positionValue = position * stock.price;
  const positionPnlPct = getWhalePositionPnlPct(whale, stock);
  const valuation = getValuationSnapshot(stock);
  const memory = getMarketMemory(game, stock);
  const effectiveDepth = calculateEffectiveDepth(stock);
  const hotSector = game.sectors[stock.sector].attention > 52 || game.sectors[stock.sector].momentum > 8;
  const runnerExhaustion = getRunnerExhaustion(stock, memory, valuation.valuationGap);
  const gapFadeRisk = Math.max(0, -memory.openingGapPct - 0.7) * Math.max(0, memory.openToNowPct - 0.8) * 2.1;
  const overextension =
    Math.max(0, valuation.valuationGap) * 30 +
    Math.max(0, memory.return5d - 10) * 1.5 +
    Math.max(0, memory.return10d - 18) * 0.55 +
    Math.max(0, memory.upStreak - 2) * 4.5 +
    Math.max(0, memory.greenDays5d - 3) * 4.2 +
    Math.max(0, memory.openingGapPct - 2) * 2.2 +
    gapFadeRisk * 0.75 +
    runnerExhaustion * 0.35;
  const washout =
    Math.max(0, -valuation.valuationGap) * 28 +
    Math.max(0, -memory.return3d - 4) * 1.5 +
    Math.max(0, -memory.drawdownFrom10dHigh - 8) * 1.2 +
    (stock.microstructure.flowMemory > 5 ? 6 : 0);
  const fragility =
    (stock.boardState === "weakSeal" || stock.boardState === "brokenBoard" ? 20 : 0) +
    memory.boardBreaks5d * 5 +
    (memory.lastTickMovePct < -0.35 ? 7 : 0);
  const playerSignal = playerVisibility * 0.55;
  const inventorySignal = positionValue > 0 ? Math.min(36, positionValue / Math.max(1, effectiveDepth) * 14 + Math.max(0, positionPnlPct) * 80) : 0;
  const preference = (likesSector ? 18 : -8) + (likesCap ? 10 : -6) + (positionValue > 0 ? 8 : 0);

  if (whale.archetype === "pumpLord") {
    return preference + playerSignal + inventorySignal + (hotSector ? 14 : 0) + stock.attention * 0.18 - overextension * 0.35 - stock.heat * 0.18;
  }
  if (whale.archetype === "quantKnife") {
    return (likesSector ? 14 : -4) + playerSignal + inventorySignal + overextension * 0.72 + runnerExhaustion * 0.5 + fragility * 0.85 + Math.max(0, -stock.momentum - 28) * 0.22;
  }
  if (whale.archetype === "valueWall") {
    return preference + inventorySignal + washout * 0.9 + overextension * (positionValue > 0 ? 0.78 : -0.18) - (capClass === "large" ? 0 : positionValue > 0 ? 2 : 12);
  }
  if (whale.archetype === "rescueWhale") {
    return (
      (capClass === "large" ? 26 : -30) +
      washout +
      inventorySignal * 1.1 +
      (positionValue > 0 ? (runnerExhaustion + gapFadeRisk) * 0.55 : 0) +
      (game.market.sentiment < 44 ? 12 : 0) -
      Math.max(0, valuation.valuationGap) * (positionValue > 0 ? 12 : 24)
    );
  }
  if (whale.archetype === "bagholderWhale") {
    return preference + playerSignal + inventorySignal * 1.25 + fragility * 0.45 + (positionPnlPct > -0.02 ? stock.retail.greed * 0.15 : 0);
  }
  if (whale.archetype === "sectorRotator") {
    return (
      (likesCap ? 12 : -6) +
      (likesSector && hotSector ? 28 : -3) +
      playerSignal +
      inventorySignal +
      (positionValue > 0 ? (runnerExhaustion + gapFadeRisk) * 0.62 : -overextension * 0.22)
    );
  }
  if (whale.archetype === "liquidityVulture") {
    return preference + washout * 1.15 + playerSignal * 0.45 + inventorySignal + fragility * 0.4 + (positionValue > 0 ? (runnerExhaustion + gapFadeRisk) * 0.36 : 0);
  }

  return 0;
}

function getRunnerExhaustion(stock: Stock, memory: MarketMemorySnapshot, valuationGap: number): number {
  const smoothRunnerBonus = memory.greenDays5d >= 4 && memory.realizedVolatility5d < 3.2 ? 8 : 0;
  return Math.max(
    0,
    Math.max(0, memory.return5d - 9) * 1.28 +
      Math.max(0, memory.return10d - 16) * 0.58 +
      Math.max(0, memory.upStreak - 2) * 5 +
      Math.max(0, memory.greenDays5d - 3) * 5 +
      Math.max(0, memory.ma5Deviation - 5.5) * 1.4 +
      Math.max(0, memory.openingGapPct - 2) * 2.4 +
      Math.max(0, -memory.openingGapPct - 0.7) * Math.max(0, memory.openToNowPct - 0.8) * 1.55 +
      Math.max(0, valuationGap - 0.3) * 32 +
      Math.max(0, stock.price / Math.max(0.01, stock.avgHolderCost) - 1.08) * 34 +
      smoothRunnerBonus
  );
}

function setCampaignPhase(game: GameState, whale: Whale, phase: NonNullable<Whale["campaign"]>["phase"]): void {
  if (!whale.campaign) return;
  whale.campaign.phase = phase;
  whale.campaign.phaseStartedTick = getAbsoluteTick(game);
}

function getCampaignMaxEntryPrice(stock: Stock, valuationGap: number): number {
  if (stock.financialHealth < 38) return stock.avgHolderCost * (valuationGap < 0 ? 1.02 : 0.94);
  return stock.avgHolderCost * (valuationGap < 0.2 ? 1.08 : 1.0);
}

function isWhaleOnCooldown(game: GameState, whale: Whale): boolean {
  return getAbsoluteTick(game) < (whale.nextActionTick ?? 0);
}

function getAbsoluteTick(game: GameState): number {
  return (game.day - 1) * GAME_CONFIG.ticksPerDay + game.tick;
}

function getWhaleCooldown(whale: Whale, intention: WhaleIntention): number {
  const archetypeBase: Record<Whale["archetype"], number> = {
    pumpLord: 4,
    quantKnife: 3,
    valueWall: 8,
    rescueWhale: 10,
    bagholderWhale: 5,
    sectorRotator: 6,
    liquidityVulture: 5
  };
  const intentionModifier: Partial<Record<WhaleIntention, number>> = {
    accumulate: 2,
    pump: 1,
    defend: 1,
    attack: 1,
    dump: 2,
    rotate: 3,
    scoop: 2
  };
  const patienceDelay = Math.round(whale.patience / 28);
  const aggressionDiscount = Math.round(whale.aggression / 45);
  return Math.max(2, archetypeBase[whale.archetype] + (intentionModifier[intention] ?? 0) + patienceDelay - aggressionDiscount);
}

function getWhaleBuyCash(
  whale: Whale,
  stock: Stock,
  effectiveDepth: number,
  cashPct: number,
  depthPct: number,
  valuationGap: number
): number {
  const overvalueBrake = valuationGap > 0.55 ? 0.48 : valuationGap > 0.3 ? 0.68 : valuationGap > 0.12 ? 0.84 : 1;
  const dipBoost = valuationGap < -0.22 && stock.financialHealth > 50 ? 1.18 : 1;
  const heatBrake = stock.heat > whale.heatTolerance ? 0.55 : 1;
  return Math.min(whale.cash * cashPct * overvalueBrake * dipBoost * heatBrake, effectiveDepth * depthPct * overvalueBrake * dipBoost);
}

function getWhaleSellShares(
  stock: Stock,
  position: number,
  effectiveDepth: number,
  depthPct: number,
  dayChangePct: number,
  valuationGap: number,
  positionPnlPct: number
): number {
  const panicBrake = dayChangePct < -3 && valuationGap < 0.45 ? 0.48 : 1;
  const boardBrake = stock.boardState === "panic" || stock.boardState === "limitDown" ? 0.42 : stock.boardState === "loose" ? 0.72 : 1;
  const overvalueBoost = valuationGap > 0.7 ? 1.18 : valuationGap > 0.35 ? 1.05 : 1;
  const pnlBrake = positionPnlPct < -0.08 && valuationGap < 0.25 ? 0.28 : positionPnlPct < 0 ? 0.55 : 1;
  const profitBoost = positionPnlPct > 0.18 ? 1.16 : positionPnlPct > 0.08 ? 1.06 : 1;
  return Math.min(position, roundShares((effectiveDepth * depthPct * panicBrake * boardBrake * overvalueBoost * pnlBrake * profitBoost) / stock.price));
}

function appendWhaleEvent(game: GameState, stock: Stock, fill: ExecutionFill): void {
  if (fill.filledNotional < 750_000) return;

  const verb = fill.side === "buy" ? "bought" : "sold";
  game.eventLog.push({
    day: game.day,
    tick: game.tick,
    type: "whaleTrade",
    stockId: stock.id,
    message: `${fill.ownerName} ${verb} ${fill.filledShares.toLocaleString()} shares of ${stock.name} at avg ${fill.avgPrice.toFixed(
      2
    )} (${fill.intention}); price ${stock.price.toFixed(2)}.`
  });
}

function recordBuyFillForWhale(stock: Stock, fill: ExecutionFill): void {
  stock.volume += fill.filledShares;
  stock.turnover = roundMoney(stock.turnover + fill.filledNotional);
}

function recordSellFillForWhale(stock: Stock, fill: ExecutionFill): void {
  stock.volume += fill.filledShares;
  stock.turnover = roundMoney(stock.turnover + fill.filledNotional);
}
