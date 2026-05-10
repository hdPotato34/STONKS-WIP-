import { createInitialGame } from "../game/createInitialGame";
import { GAME_CONFIG } from "../game/config";
import type { TickResult } from "../game/types";
import { getMarketCapClass } from "../simulation/marketDepth";
import { findStockTrace, formatTickTraceTable } from "../simulation/scenarioTools";
import { updateTick } from "../simulation/tick";

const seed = process.argv[2] ?? "demo-seed";
const game = createInitialGame(seed);

console.log(`Whale-Sim headless run`);
console.log(`Seed: ${game.rngSeed}`);
console.log(`Phase: ${game.phase}`);
console.log("");
console.log("Initial market:");

for (const stock of Object.values(game.stocks)) {
  console.log(
    `${stock.id.padEnd(18)} ${stock.name.padEnd(24)} ${stock.price.toFixed(2).padStart(7)} ` +
      `${stock.sector.padEnd(9)} ${stock.boardType.padEnd(6)} ${getMarketCapClass(stock).padEnd(5)} ` +
      `cap=${(stock.marketCap / 1_000_000_000).toFixed(1)}B liquidity=${(stock.currentLiquidity / 1_000_000).toFixed(1)}M ` +
      `attention=${stock.attention.toFixed(0)} heat=${stock.heat.toFixed(0)}`
  );
}

const traceResults: TickResult[] = [];
traceResults.push(updateTick(game));
traceResults.push(updateTick(game));

const attackTick = updateTick(game, [
  {
    type: "marketBuy",
    stockId: "DRAGON_SOFT",
    amountCash: 18_000_000
  }
]);
traceResults.push(attackTick);

const attackTrace = findStockTrace(attackTick, "DRAGON_SOFT");
const playerFill = attackTrace.playerFills[0];
console.log("");
console.log("Player attack trace:");
console.log(
  `DragonSoft ${attackTrace.marketCapClass} cap=${(game.stocks.DRAGON_SOFT.marketCap / 1_000_000_000).toFixed(
    1
  )}B depth=${(attackTrace.effectiveDepth / 1_000_000).toFixed(1)}M ask=${(attackTrace.askNotional / 1_000_000).toFixed(
    1
  )}M price ${attackTrace.priceBefore.toFixed(2)} -> ${attackTrace.priceAfter.toFixed(2)} board=${attackTrace.boardState}`
);
if (playerFill) {
  console.log(
    `Filled=${playerFill.filledNotional.toLocaleString()} unfilled=${playerFill.unfilledCash.toLocaleString()} ` +
      `shares=${playerFill.filledShares.toLocaleString()} avg=${playerFill.avgPrice.toFixed(2)}`
  );
}
for (const order of attackTrace.restingOrders) {
  console.log(
    `Resting order ${order.orderId}: remaining=${order.remainingCash.toLocaleString()} ticks=${order.remainingTicks} visibility=${order.visibility.toFixed(
      1
    )}`
  );
}

while (game.phase === "intraday") {
  traceResults.push(updateTick(game));
}

if (game.phase === "closingAuction") {
  traceResults.push(updateTick(game));
}

console.log("");
console.log(`After one trading day (${GAME_CONFIG.ticksPerDay} ticks):`);
console.log(`Day: ${game.day}, phase: ${game.phase}`);
console.log(`Cash: ${game.player.cash.toLocaleString()}`);
console.log(`Net worth: ${game.player.netWorth.toLocaleString()}`);

const position = game.player.positions.DRAGON_SOFT;
if (position) {
  console.log(
    `DragonSoft position: total=${position.totalShares.toLocaleString()} sellable=${position.sellableShares.toLocaleString()} ` +
      `locked=${position.lockedShares.toLocaleString()} avgCost=${position.avgCost.toFixed(2)}`
  );
}

console.log("");
console.log("DragonSoft trace table:");
console.log(formatTickTraceTable(traceResults.slice(0, 8), "DRAGON_SOFT"));

console.log("");
console.log("Recent events:");
for (const event of game.eventLog.slice(-12)) {
  console.log(`[D${event.day} T${event.tick}] ${event.message}`);
}
