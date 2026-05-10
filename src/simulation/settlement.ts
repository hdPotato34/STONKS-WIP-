import { clamp, GAME_CONFIG, roundMoney } from "../game/config";
import { startDailyCandle, syncDailyCandle } from "../game/charting";
import { calculateFairPe, deriveProfitGrowth, getValuationSnapshot, updateValuationFromPrice } from "../game/fundamentals";
import { createRng } from "../game/rng";
import type { GameState, Stock } from "../game/types";
import { recalculatePlayerNetWorth } from "../player/portfolio";
import { getMarketMemory } from "./marketMemory";
import { markAllWhalesToMarket } from "./whaleAccounting";

export function settleDay(game: GameState): void {
  for (const stock of Object.values(game.stocks)) {
    settleStock(game, stock, game.day + 1);
  }

  for (const position of Object.values(game.player.positions)) {
    if (!position) continue;
    position.sellableShares += position.lockedShares;
    position.lockedShares = 0;
  }

  for (const news of game.news) {
    news.remainingDays -= 1;
  }
  game.news = game.news.filter((news) => news.remainingDays > 0);

  const releasedCash = roundMoney(
    game.player.activeOrders
      .filter((order) => order.owner === "player" && order.side === "buy")
      .reduce((total, order) => total + (order.amountCash ?? 0), 0)
  );
  if (releasedCash > 0) {
    game.player.cash = roundMoney(game.player.cash + releasedCash);
    game.eventLog.push({
      day: game.day,
      tick: game.tick,
      type: "restingOrdersCleared",
      message: `Settlement released ${releasedCash.toLocaleString()} of unfilled player buy interest.`
    });
  }
  game.player.activeOrders = [];

  game.player.accountHeat = clamp(game.player.accountHeat * 0.92, 0, GAME_CONFIG.maxAccountHeat);
  markAllWhalesToMarket(game);
  recalculatePlayerNetWorth(game);

  game.eventLog.push({
    day: game.day,
    tick: game.tick,
    type: "settlement",
    message: `Day ${game.day} settled. Net worth: ${roundMoney(game.player.netWorth).toLocaleString()}.`
  });

  if (game.day >= GAME_CONFIG.totalDays) {
    game.phase = "ended";
    game.eventLog.push({
      day: game.day,
      tick: game.tick,
      type: "runEnded",
      message: "The 30-day run has ended."
    });
    return;
  }

  game.day += 1;
  game.tick = 0;
  game.phase = "preMarket";
}

function settleStock(game: GameState, stock: Stock, nextDay: number): void {
  syncDailyCandle(stock, game.day);
  const memory = getMarketMemory(game, stock);
  const closeMovePct = stock.open > 0 ? ((stock.price - stock.open) / stock.open) * 100 : 0;
  stock.previousClose = stock.price;
  stock.open = stock.price;
  stock.high = stock.price;
  stock.low = stock.price;
  stock.microPrice = stock.price;
  stock.microstructure.flowMemory = 0;
  stock.microstructure.liquidityStress = 0;
  stock.microstructure.shockMemory = 0;
  stock.microstructure.lastPrintSign = 0;
  stock.turnover = 0;
  stock.volume = 0;
  stock.momentum = 0;
  stock.buyQueue = 0;
  stock.sellQueue = 0;
  stock.boardStrength = 0;
  stock.boardState = "loose";
  stock.avgHolderCost = roundMoney(stock.avgHolderCost * 0.94 + stock.price * 0.06);
  digestKnownFundamentals(game, stock);
  updateValuationFromPrice(stock);
  const valuation = getValuationSnapshot(stock);
  const washoutRelief = clamp(Math.max(0, -valuation.valuationGap - 0.08) + Math.max(0, -closeMovePct - 5) / 45, 0, 0.48);
  const calmRelief = stock.boardState === "loose" && closeMovePct > -1.5 ? 0.14 : 0;
  const recoveryRelief = clamp(
    calmRelief + Math.max(0, closeMovePct - 1.5) / 22 + Math.max(0, stock.price / Math.max(0.01, stock.avgHolderCost) - 1) * 0.18,
    0,
    0.36
  );

  stock.sentiment = clamp(stock.sentiment * (0.96 - washoutRelief * 0.08) + 50 * (0.04 + washoutRelief * 0.08), 0, 100);
  stock.attention = clamp(stock.attention * (0.9 - washoutRelief * 0.08) + 35 * (0.1 + washoutRelief * 0.08), 0, 100);
  stock.heat = clamp(stock.heat * (0.78 - washoutRelief * 0.18), 0, GAME_CONFIG.maxStockHeat);
  stock.retail.greed = clamp(stock.retail.greed * (0.86 - washoutRelief * 0.07) + (45 + washoutRelief * 10) * (0.14 + washoutRelief * 0.07), 0, 100);
  stock.retail.fear = clamp(
    stock.retail.fear * (0.84 - washoutRelief * 0.22 - recoveryRelief * 0.3) +
      (34 - washoutRelief * 5 - recoveryRelief * 10) * (0.16 + washoutRelief * 0.22 + recoveryRelief * 0.18),
    0,
    100
  );
  stock.retail.panicSellers = clamp(
    stock.retail.panicSellers * (0.82 - washoutRelief * 0.24 - recoveryRelief * 0.28) +
      (28 - washoutRelief * 5 - recoveryRelief * 8) * (0.18 + washoutRelief * 0.24 + recoveryRelief * 0.14),
    0,
    100
  );
  if (stock.boardState === "loose" && closeMovePct > -1.5) {
    stock.retail.fear = clamp(stock.retail.fear - 3.5 - recoveryRelief * 9, 0, 100);
    stock.retail.panicSellers = clamp(stock.retail.panicSellers - 2.8 - recoveryRelief * 7, 0, 100);
  }
  stock.retail.boardFaith = clamp(stock.retail.boardFaith * 0.84 + (34 + washoutRelief * 6) * 0.16, 0, 100);
  stock.chart = [
    {
      day: nextDay,
      tick: 0,
      price: stock.price,
      boardState: stock.boardState
    }
  ];
  startDailyCandle(stock, nextDay);
  applyDailyCircumstance(game, stock, nextDay, {
    closeMovePct,
    return5d: memory.return5d,
    realizedVolatility5d: memory.realizedVolatility5d,
    upStreak: memory.upStreak,
    downStreak: memory.downStreak,
    drawdownFrom10dHigh: memory.drawdownFrom10dHigh
  });
}

function applyDailyCircumstance(
  game: GameState,
  stock: Stock,
  nextDay: number,
  memory: {
    closeMovePct: number;
    return5d: number;
    realizedVolatility5d: number;
    upStreak: number;
    downStreak: number;
    drawdownFrom10dHigh: number;
  }
): void {
  const rng = createRng(`${game.rngSeed}:daily-circumstance:${nextDay}:${stock.id}`);
  const sector = game.sectors[stock.sector];
  const moodShock = rng.float(-5.5, 5.5) + (sector.momentum / 100) * 3;
  const liquidityShock = rng.float(-0.16, 0.18) + Math.min(0.12, Math.abs(memory.closeMovePct) / 80 + memory.realizedVolatility5d / 160);
  const overrunFatigue = Math.max(0, memory.return5d - 18) * 0.22 + Math.max(0, memory.upStreak - 3) * 1.25;
  const washoutAttention = Math.max(0, -memory.drawdownFrom10dHigh - 9) * 0.42 + Math.max(0, memory.downStreak - 1) * 2.4;

  stock.attention = clamp(stock.attention + moodShock * 0.65 + washoutAttention + Math.abs(memory.closeMovePct) * 0.18, 0, 100);
  stock.sentiment = clamp(stock.sentiment + moodShock * 0.42 - overrunFatigue * 0.34 + washoutAttention * 0.16, 0, 100);
  stock.heat = clamp(stock.heat + Math.abs(moodShock) * 0.18 + overrunFatigue * 0.16 + washoutAttention * 0.04, 0, GAME_CONFIG.maxStockHeat);
  stock.currentLiquidity = Math.max(1_000_000, stock.baseLiquidity * (1 + liquidityShock));
  stock.retail.greed = clamp(stock.retail.greed + moodShock * 0.28 - overrunFatigue * 0.32 + washoutAttention * 0.18, 0, 100);
  stock.retail.dipBuyers = clamp(stock.retail.dipBuyers + washoutAttention * 0.42 + Math.max(0, -memory.closeMovePct - 4) * 0.26, 0, 100);
  stock.retail.fear = clamp(stock.retail.fear - moodShock * 0.22 + washoutAttention * 0.08 + Math.max(0, -memory.closeMovePct - 4) * 0.16, 0, 100);
  stock.retail.panicSellers = clamp(stock.retail.panicSellers + washoutAttention * 0.04 + Math.max(0, -memory.closeMovePct - 5) * 0.12, 0, 100);
  if (memory.drawdownFrom10dHigh < -24 && stock.retail.fear < 25) {
    stock.heat = clamp(stock.heat * 0.72, 0, GAME_CONFIG.maxStockHeat);
  }

  if (Math.abs(moodShock) > 4.4 || overrunFatigue > 3 || washoutAttention > 3.2) {
    const message =
      overrunFatigue > washoutAttention && overrunFatigue > 3
        ? `${stock.name} opens with rally fatigue after a multi-day run.`
        : washoutAttention > 3.2
          ? `${stock.name} opens with bargain hunters watching the drawdown.`
          : moodShock > 0
            ? `${stock.name} opens with fresh attention.`
            : `${stock.name} opens with softer risk appetite.`;
    game.eventLog.push({
      day: nextDay,
      tick: 0,
      type: "marketCircumstance",
      stockId: stock.id,
      message
    });
  }
}

function digestKnownFundamentals(game: GameState, stock: Stock): void {
  if (game.day % 5 !== 0) return;

  const rng = createRng(`${game.rngSeed}:fundamentals:${game.day}:${stock.id}`);
  const longRunGrowth = deriveProfitGrowth(stock.sector, stock.financialHealth);
  const oldGrowth = stock.profitGrowth;
  const oldEps = stock.earningsPerShare;
  const sector = game.sectors[stock.sector];
  const sectorAdjustment = (sector.sentiment - 50) * 0.025 + sector.momentum * 0.035;
  const growthShock = rng.float(-2.4, 2.4) + sectorAdjustment;

  stock.profitGrowth = roundMoney(clamp(stock.profitGrowth * 0.82 + longRunGrowth * 0.18 + growthShock, -28, 42));
  const epsDrift = clamp(stock.profitGrowth / 100 / 8 + rng.float(-0.012, 0.012), -0.055, 0.065);
  stock.earningsPerShare = roundMoney(Math.max(0.01, stock.earningsPerShare * (1 + epsDrift)));
  stock.financialHealth = roundMoney(clamp(stock.financialHealth + (stock.profitGrowth - oldGrowth) * 0.045 + rng.float(-0.55, 0.55), 5, 95));
  stock.fairPe = calculateFairPe(stock.sector, stock.boardType, stock.financialHealth, stock.profitGrowth);

  const epsChangePct = oldEps > 0 ? ((stock.earningsPerShare - oldEps) / oldEps) * 100 : 0;
  if (Math.abs(epsChangePct) >= 3 || Math.abs(stock.profitGrowth - oldGrowth) >= 4) {
    const direction = epsChangePct >= 0 ? "improved" : "softened";
    game.eventLog.push({
      day: game.day,
      tick: game.tick,
      type: "fundamentalDigest",
      stockId: stock.id,
      message: `${stock.name} fundamentals ${direction}: EPS ${epsChangePct.toFixed(1)}%, growth ${stock.profitGrowth.toFixed(
        1
      )}%, fair PE ${stock.fairPe.toFixed(1)}.`
    });
  }
}
