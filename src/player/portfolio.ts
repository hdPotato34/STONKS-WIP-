import { roundMoney, roundShares } from "../game/config";
import type { GameState, Position, Stock, StockId } from "../game/types";

export function getOrCreatePosition(game: GameState, stockId: StockId): Position {
  const existing = game.player.positions[stockId];
  if (existing) return existing;

  const position: Position = {
    stockId,
    totalShares: 0,
    sellableShares: 0,
    lockedShares: 0,
    avgCost: 0,
    realizedPnl: 0
  };

  game.player.positions[stockId] = position;
  return position;
}

export function buyShares(game: GameState, stock: Stock, amountCash: number): number {
  const spend = Math.min(game.player.cash, Math.max(0, amountCash));
  const shares = roundShares(spend / stock.price);
  const actualCost = roundMoney(shares * stock.price);

  if (shares <= 0 || actualCost <= 0) return 0;

  const position = getOrCreatePosition(game, stock.id);
  const oldCostBasis = position.avgCost * position.totalShares;
  const newTotalShares = position.totalShares + shares;

  position.totalShares = newTotalShares;
  position.lockedShares += shares;
  position.avgCost = roundMoney((oldCostBasis + actualCost) / newTotalShares);
  game.player.cash = roundMoney(game.player.cash - actualCost);

  stock.volume += shares;
  stock.turnover += actualCost;

  return shares;
}

export function recordBuyFill(game: GameState, stock: Stock, shares: number, actualCost: number): void {
  const filledShares = roundShares(shares);
  const cost = roundMoney(actualCost);

  if (filledShares <= 0 || cost <= 0) return;

  const position = getOrCreatePosition(game, stock.id);
  const oldCostBasis = position.avgCost * position.totalShares;
  const newTotalShares = position.totalShares + filledShares;

  position.totalShares = newTotalShares;
  position.lockedShares += filledShares;
  position.avgCost = roundMoney((oldCostBasis + cost) / newTotalShares);

  stock.volume += filledShares;
  stock.turnover += cost;
}

export function sellShares(game: GameState, stock: Stock, requestedShares: number): number {
  const position = game.player.positions[stock.id];
  if (!position) return 0;

  const shares = Math.min(roundShares(requestedShares), position.sellableShares);
  if (shares <= 0) return 0;

  const proceeds = roundMoney(shares * stock.price);
  const costBasis = roundMoney(shares * position.avgCost);

  position.totalShares -= shares;
  position.sellableShares -= shares;
  position.realizedPnl = roundMoney(position.realizedPnl + proceeds - costBasis);
  game.player.realizedPnl = roundMoney(game.player.realizedPnl + proceeds - costBasis);
  game.player.cash = roundMoney(game.player.cash + proceeds);

  if (position.totalShares <= 0) {
    delete game.player.positions[stock.id];
  }

  stock.volume += shares;
  stock.turnover += proceeds;

  return shares;
}

export function recordSellFill(game: GameState, stock: Stock, shares: number, proceeds: number): void {
  const position = game.player.positions[stock.id];
  if (!position) return;

  const filledShares = Math.min(roundShares(shares), position.sellableShares);
  const cashProceeds = roundMoney(proceeds);
  if (filledShares <= 0 || cashProceeds <= 0) return;

  const costBasis = roundMoney(filledShares * position.avgCost);

  position.totalShares -= filledShares;
  position.sellableShares -= filledShares;
  position.realizedPnl = roundMoney(position.realizedPnl + cashProceeds - costBasis);
  game.player.realizedPnl = roundMoney(game.player.realizedPnl + cashProceeds - costBasis);
  game.player.cash = roundMoney(game.player.cash + cashProceeds);

  if (position.totalShares <= 0) {
    delete game.player.positions[stock.id];
  }

  stock.volume += filledShares;
  stock.turnover += cashProceeds;
}

export function getReservedCash(game: GameState): number {
  return roundMoney(
    game.player.activeOrders
      .filter((order) => order.owner === "player" && order.side === "buy")
      .reduce((total, order) => total + (order.amountCash ?? 0), 0)
  );
}

export function recalculatePlayerNetWorth(game: GameState): void {
  let unrealized = 0;

  for (const position of Object.values(game.player.positions)) {
    if (!position) continue;
    const stock = game.stocks[position.stockId];
    unrealized += (stock.price - position.avgCost) * position.totalShares;
  }

  const holdingsValue = Object.values(game.player.positions).reduce((total, position) => {
    if (!position) return total;
    return total + game.stocks[position.stockId].price * position.totalShares;
  }, 0);

  game.player.unrealizedPnl = roundMoney(unrealized);
  game.player.netWorth = roundMoney(game.player.cash + getReservedCash(game) + holdingsValue);
}
