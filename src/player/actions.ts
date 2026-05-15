import { clamp, roundMoney } from "../game/config";
import type { ExecutionFill, GameState, MarketDepth, Order, PlayerAction, RestingOrderTrace, Stock } from "../game/types";
import { recordBuyFill, recordSellFill } from "./portfolio";
import { executeBuyFromDepth, executeSellIntoDepth } from "../simulation/marketDepth";
import { applyExecutionPrice } from "../simulation/priceEngine";
import { getUpperLimit } from "../simulation/boardEngine";
import { addBoardQueue } from "../simulation/boardQueueLedger";
import { MARKET_BEHAVIOR_CONFIG } from "../simulation/marketBehaviorConfig";

const playerOrderConfig = MARKET_BEHAVIOR_CONFIG.playerOrders;

export type AppliedPlayerPressure = {
  stockId: string;
  buyPressure: number;
  sellPressure: number;
  visibility: number;
  fills: ExecutionFill[];
  restingOrders: RestingOrderTrace[];
};

export function processPlayerOrdersForStock(
  game: GameState,
  stock: Stock,
  depth: MarketDepth,
  actions: PlayerAction[]
): AppliedPlayerPressure {
  queueNewPlayerOrders(game, stock, actions);

  const applied: AppliedPlayerPressure = {
    stockId: stock.id,
    buyPressure: 0,
    sellPressure: 0,
    visibility: 0,
    fills: [],
    restingOrders: []
  };

  processActiveBuyOrders(game, stock, depth, applied);
  processImmediateSellActions(game, stock, depth, actions, applied);

  applied.restingOrders = game.player.activeOrders
    .filter((order) => order.owner === "player" && order.side === "buy" && order.stockId === stock.id)
    .map((order) => ({
      orderId: order.id,
      stockId: order.stockId,
      remainingCash: roundMoney(order.amountCash ?? 0),
      remainingTicks: order.remainingTicks ?? 0,
      visibility: order.visibility
    }));

  return applied;
}

function queueNewPlayerOrders(game: GameState, stock: Stock, actions: PlayerAction[]): void {
  let actionIndex = 0;
  for (const action of actions) {
    if (action.stockId !== stock.id) continue;
    if (action.type !== "marketBuy") continue;

    const reservedCash = roundMoney(Math.min(game.player.cash, Math.max(0, action.amountCash)));
    if (reservedCash <= 0) continue;

    const order: Order = {
      id: `P-${game.day}-${game.tick}-${stock.id}-${actionIndex}`,
      owner: "player",
      stockId: stock.id,
      side: "buy",
      style: "restingBuy",
      amountCash: reservedCash,
      limitPrice: action.limitPrice,
      remainingTicks: playerOrderConfig.defaultRestingBuyTicks,
      visibility: calculateRestingBuyVisibility(stock, reservedCash, action.limitPrice),
      heatImpact: calculateRestingBuyVisibility(stock, reservedCash, action.limitPrice) * playerOrderConfig.heatImpactPerVisibility,
      createdDay: game.day,
      createdTick: game.tick
    };

    game.player.cash = roundMoney(game.player.cash - reservedCash);
    game.player.activeOrders.push(order);
    game.eventLog.push({
      day: game.day,
      tick: game.tick,
      type: "playerOrder",
      stockId: stock.id,
      message: `Player placed visible buy interest of ${reservedCash.toLocaleString()} in ${stock.name}${
        action.limitPrice ? ` with limit ${action.limitPrice.toFixed(2)}` : ""
      } at price ${stock.price.toFixed(2)}.`
    });
    actionIndex += 1;
  }
}

function processActiveBuyOrders(
  game: GameState,
  stock: Stock,
  depth: MarketDepth,
  applied: AppliedPlayerPressure
): void {
  const nextOrders: Order[] = [];

  for (const order of game.player.activeOrders) {
    if (order.owner !== "player" || order.stockId !== stock.id || order.side !== "buy") {
      nextOrders.push(order);
      continue;
    }

    const requestedCash = roundMoney(order.amountCash ?? 0);
    const fill = executeBuyFromDepth(stock, depth, requestedCash, "player", {}, { limitPrice: order.limitPrice });

    if (fill.filledShares > 0) {
      applyExecutionPrice(stock, fill.finalPrice);
      recordBuyFill(game, stock, fill.filledShares, fill.filledNotional);
      applied.fills.push(fill);
      applied.buyPressure += fill.filledNotional;
      addHeat(game, stock, calculateVisibility(stock, fill.filledNotional) * playerOrderConfig.heatImpactPerVisibility);
      game.eventLog.push({
        day: game.day,
        tick: game.tick,
        type: "playerBuy",
        stockId: stock.id,
        message: `Player filled ${fill.filledShares.toLocaleString()} shares of ${stock.name} at avg ${fill.avgPrice.toFixed(
          2
        )}; price ${stock.price.toFixed(2)}.`
      });
    }

    const remainingCash = roundMoney(fill.unfilledCash);
    if (remainingCash <= playerOrderConfig.minResidualCash) continue;

    order.amountCash = remainingCash;
    order.visibility = calculateRestingBuyVisibility(stock, remainingCash, order.limitPrice);
    order.heatImpact = order.visibility * playerOrderConfig.heatImpactPerVisibility;
    addHeat(game, stock, order.heatImpact * playerOrderConfig.restingHeatTickShare);
    applied.visibility = Math.max(applied.visibility, order.visibility);

    if (stock.price >= getUpperLimit(stock) && canJoinUpperQueue(stock, order)) {
      if (order.style !== "support") {
        addBoardQueue(stock, "buy", remainingCash, { player: remainingCash });
        order.style = "support";
      }
      applied.buyPressure += remainingCash * playerOrderConfig.upperQueuePressureShare;
    } else {
      const marketableInterest = order.limitPrice === undefined || order.limitPrice >= stock.price;
      applied.buyPressure += marketableInterest
        ? remainingCash * playerOrderConfig.marketableRestingPressureShare
        : remainingCash * getDeepRestingBuyPressureWeight(stock, order.limitPrice);
    }

    if (stock.boardState !== "sealedLimitUp" && stock.boardState !== "weakSeal") {
      order.remainingTicks = Math.max(0, (order.remainingTicks ?? 0) - 1);
    }

    if ((order.remainingTicks ?? 0) <= 0 && stock.boardState !== "sealedLimitUp" && stock.boardState !== "weakSeal") {
      game.player.cash = roundMoney(game.player.cash + remainingCash);
      game.eventLog.push({
        day: game.day,
        tick: game.tick,
        type: "playerOrderExpired",
        stockId: stock.id,
        message: `Player buy interest in ${stock.name} expired with ${remainingCash.toLocaleString()} unfilled at price ${stock.price.toFixed(
          2
        )}.`
      });
      continue;
    }

    nextOrders.push(order);
  }

  game.player.activeOrders = nextOrders;
}

function processImmediateSellActions(
  game: GameState,
  stock: Stock,
  depth: MarketDepth,
  actions: PlayerAction[],
  applied: AppliedPlayerPressure
): void {
  for (const action of actions) {
    if (action.stockId !== stock.id || action.type !== "marketSell") continue;

    const position = game.player.positions[stock.id];
    const requestedShares = Math.min(action.shares, position?.sellableShares ?? 0);
    const fill = executeSellIntoDepth(stock, depth, requestedShares, "player", {}, { limitPrice: action.limitPrice });

    if (fill.filledShares <= 0) continue;

    applyExecutionPrice(stock, fill.finalPrice);
    recordSellFill(game, stock, fill.filledShares, fill.filledNotional);
    applied.fills.push(fill);
    applied.sellPressure += fill.filledNotional;
    applied.visibility = Math.max(applied.visibility, calculateVisibility(stock, fill.filledNotional));
    addHeat(game, stock, calculateVisibility(stock, fill.filledNotional) * playerOrderConfig.sellHeatImpactPerVisibility);

    game.eventLog.push({
      day: game.day,
      tick: game.tick,
      type: "playerSell",
      stockId: stock.id,
      message: `Player sold ${fill.filledShares.toLocaleString()} shares of ${stock.name} at avg ${fill.avgPrice.toFixed(
        2
      )}; price ${stock.price.toFixed(2)}.`
    });
  }
}

function calculateVisibility(stock: Stock, notional: number): number {
  if (notional <= 0) return 0;
  return clamp((notional / Math.max(1, stock.currentLiquidity)) * playerOrderConfig.visibilityScale, 0, 100);
}

export function calculateRestingBuyVisibility(stock: Stock, notional: number, limitPrice?: number): number {
  return calculateVisibility(stock, notional) * getBuyOrderProximityWeight(stock, limitPrice);
}

function getDeepRestingBuyPressureWeight(stock: Stock, limitPrice?: number): number {
  if (limitPrice === undefined || limitPrice >= stock.price) return playerOrderConfig.marketableRestingPressureShare;
  return playerOrderConfig.deepRestingPressureShare * getBuyOrderProximityWeight(stock, limitPrice);
}

function getBuyOrderProximityWeight(stock: Stock, limitPrice?: number): number {
  if (limitPrice === undefined || limitPrice >= stock.price) return 1;
  if (limitPrice <= 0) return 0;
  if (
    limitPrice <= stock.previousClose &&
    stock.price >= stock.previousClose * (1 + playerOrderConfig.ignoreBelowPreviousCloseWhenPriceAbovePct / MARKET_BEHAVIOR_CONFIG.units.percentScale)
  ) {
    return 0;
  }

  const distancePct = (stock.price - limitPrice) / Math.max(0.01, stock.price);
  if (distancePct <= 0) return 1;

  const visibleBookWindow = playerOrderConfig.visibleBookWindowPct;
  const softBookWindow = playerOrderConfig.softBookWindowPct;
  if (distancePct <= visibleBookWindow) {
    return clamp(
      playerOrderConfig.nearBookVisibilityBase - (distancePct / visibleBookWindow) * playerOrderConfig.nearBookVisibilityFade,
      playerOrderConfig.nearBookVisibilityMin,
      playerOrderConfig.nearBookVisibilityBase
    );
  }
  if (distancePct >= softBookWindow) return 0;

  const fade = 1 - (distancePct - visibleBookWindow) / (softBookWindow - visibleBookWindow);
  return clamp(Math.pow(fade, 2) * playerOrderConfig.farBookVisibilityMax, 0, playerOrderConfig.farBookVisibilityMax);
}

function canJoinUpperQueue(stock: Stock, order: Order): boolean {
  return order.limitPrice === undefined || order.limitPrice >= getUpperLimit(stock);
}

function addHeat(game: GameState, stock: Stock, heat: number): void {
  stock.heat = clamp(stock.heat + heat, 0, 100);
  game.player.accountHeat = clamp(game.player.accountHeat + heat * playerOrderConfig.accountHeatPerStockHeat, 0, 100);
}
