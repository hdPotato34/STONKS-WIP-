import { roundMoney } from "../game/config";
import type { ExecutionFill, GameState, Stock, StockId, Whale } from "../game/types";

export function initializeWhaleAccounting(whale: Whale, stocks: Record<StockId, Stock>): Whale {
  const avgCostByStock = { ...whale.avgCostByStock };

  for (const [stockId, shares] of Object.entries(whale.positions) as Array<[StockId, number | undefined]>) {
    if (!shares || shares <= 0) continue;
    const stock = stocks[stockId];
    avgCostByStock[stockId] = avgCostByStock[stockId] ?? stock.avgHolderCost ?? stock.price;
  }

  const initialized = {
    ...whale,
    avgCostByStock,
    realizedPnl: whale.realizedPnl ?? 0,
    unrealizedPnl: whale.unrealizedPnl ?? 0,
    netWorth: whale.netWorth ?? whale.cash
  };
  markWhaleToMarket(initialized, stocks);
  return initialized;
}

export function recordWhaleBuy(whale: Whale, stock: Stock, fill: ExecutionFill): void {
  const previousShares = whale.positions[stock.id] ?? 0;
  const previousCost = whale.avgCostByStock[stock.id] ?? stock.price;
  const nextShares = previousShares + fill.filledShares;

  whale.positions[stock.id] = nextShares;
  whale.avgCostByStock[stock.id] =
    nextShares > 0 ? roundMoney((previousShares * previousCost + fill.filledNotional) / nextShares) : stock.price;
}

export function recordWhaleSell(whale: Whale, stock: Stock, fill: ExecutionFill): number {
  const position = whale.positions[stock.id] ?? 0;
  const avgCost = whale.avgCostByStock[stock.id] ?? stock.price;
  const soldShares = Math.min(position, fill.filledShares);
  const realized = roundMoney((fill.avgPrice - avgCost) * soldShares);
  const remaining = Math.max(0, position - soldShares);

  whale.positions[stock.id] = remaining;
  whale.realizedPnl = roundMoney((whale.realizedPnl ?? 0) + realized);
  if (remaining <= 0) {
    delete whale.positions[stock.id];
    delete whale.avgCostByStock[stock.id];
  }

  return realized;
}

export function markAllWhalesToMarket(game: GameState): void {
  for (const whale of game.whales) {
    markWhaleToMarket(whale, game.stocks);
  }
}

export function markWhaleToMarket(whale: Whale, stocks: Record<StockId, Stock>): void {
  let inventoryValue = 0;
  let unrealizedPnl = 0;

  for (const [stockId, shares] of Object.entries(whale.positions) as Array<[StockId, number | undefined]>) {
    if (!shares || shares <= 0) continue;
    const stock = stocks[stockId];
    const avgCost = whale.avgCostByStock[stockId] ?? stock.avgHolderCost ?? stock.price;
    inventoryValue += shares * stock.price;
    unrealizedPnl += (stock.price - avgCost) * shares;
  }

  whale.unrealizedPnl = roundMoney(unrealizedPnl);
  whale.netWorth = roundMoney(whale.cash + inventoryValue);
}

export function getWhalePositionPnlPct(whale: Whale, stock: Stock): number {
  const shares = whale.positions[stock.id] ?? 0;
  if (shares <= 0) return 0;
  const avgCost = whale.avgCostByStock[stock.id] ?? stock.avgHolderCost ?? stock.price;
  return avgCost > 0 ? stock.price / avgCost - 1 : 0;
}
