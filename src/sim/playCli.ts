import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFileSync } from "node:fs";
import { GAME_CONFIG } from "../game/config";
import { createInitialGame } from "../game/createInitialGame";
import type { GameEvent, GameState, PlayerAction, Stock, StockId, TickResult } from "../game/types";
import { calculateEffectiveDepth, getMarketCapClass } from "../simulation/marketDepth";
import { findStockTrace, formatTickTraceTable } from "../simulation/scenarioTools";
import { updateTick } from "../simulation/tick";
import { getOrCreatePosition, getReservedCash, recalculatePlayerNetWorth } from "../player/portfolio";
import { money, moneyShort, pad } from "./format";

const seed = process.argv[2] ?? "play-seed";
const game = createInitialGame(seed);
const recentResults: TickResult[] = [];

printBanner();
printHelp();
printHome(game);

if (!input.isTTY) {
  const script = readFileSync(0, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of script) {
    console.log(`\nD${game.day} T${game.tick} ${game.phase}> ${line}`);
    const shouldQuit = handleCommand(line);
    if (shouldQuit || game.phase === "ended") break;
  }
  process.exit(0);
}

const rl = createInterface({ input, output });
while (game.phase !== "ended") {
  const answer = await rl.question(`\nD${game.day} T${game.tick} ${game.phase}> `);
  const shouldQuit = handleCommand(answer.trim());
  if (shouldQuit) break;
}

rl.close();

function handleCommand(raw: string): boolean {
  if (!raw) return false;

  const [command = "", ...args] = raw.split(/\s+/);
  const normalized = command.toLowerCase();

  if (normalized === "q" || normalized === "quit" || normalized === "exit") {
    console.log("Exiting Whale-Sim CLI.");
    return true;
  }

  if (normalized === "h" || normalized === "help" || normalized === "?") {
    printHelp();
    return false;
  }

  if (normalized === "home" || normalized === "status") {
    printHome(game);
    return false;
  }

  if (normalized === "m" || normalized === "market") {
    printMarket(game);
    return false;
  }

  if (normalized === "p" || normalized === "portfolio") {
    printPortfolio(game);
    return false;
  }

  if (normalized === "news") {
    printNews(game);
    return false;
  }

  if (normalized === "whales" || normalized === "w") {
    printWhales(game);
    return false;
  }

  if (normalized === "events" || normalized === "log") {
    printEvents(game.eventLog.slice(-parsePositiveInt(args[0], 12)));
    return false;
  }

  if (normalized === "stock" || normalized === "s") {
    const stock = resolveStock(args[0]);
    if (!stock) return false;
    printStockDetail(game, stock);
    return false;
  }

  if (normalized === "trace") {
    const stock = resolveStock(args[0]);
    if (!stock) return false;
    const count = parsePositiveInt(args[1], 10);
    console.log(formatTickTraceTable(recentResults.slice(-count), stock.id));
    return false;
  }

  if (normalized === "next" || normalized === "n") {
    runOneTick([]);
    return false;
  }

  if (normalized === "advance" || normalized === "a") {
    const count = Math.min(parsePositiveInt(args[0], 1), 60);
    for (let i = 0; i < count && game.phase !== "ended"; i += 1) {
      runOneTick([]);
    }
    return false;
  }

  if (normalized === "buy" || normalized === "b") {
    const stock = resolveStock(args[0]);
    const amountCash = parseMoney(args[1]);
    if (!stock || amountCash <= 0) {
      console.log("Usage: buy STOCK_ID AMOUNT. Example: buy GOLDEN_ROOF 20m");
      return false;
    }
    if (!canTrade()) return false;
    runOneTick([{ type: "marketBuy", stockId: stock.id, amountCash }]);
    return false;
  }

  if (normalized === "sell") {
    const stock = resolveStock(args[0]);
    const shares = parsePositiveInt(args[1], 0);
    if (!stock || shares <= 0) {
      console.log("Usage: sell STOCK_ID SHARES. Example: sell GOLDEN_ROOF 100000");
      return false;
    }
    if (!canTrade()) return false;
    runOneTick([{ type: "marketSell", stockId: stock.id, shares }]);
    return false;
  }

  if (normalized === "debug" || normalized === "dbg") {
    handleDebugCommand(args);
    return false;
  }

  console.log(`Unknown command: ${command}. Type "help" for commands.`);
  return false;
}

function runOneTick(actions: PlayerAction[]): void {
  const result = updateTick(game, actions);
  recentResults.push(result);
  if (recentResults.length > 80) recentResults.shift();

  printTickSummary(result);

  if (result.phaseChanged) {
    console.log(`Phase -> ${game.phase}`);
  }
}

function printBanner(): void {
  console.log("=".repeat(88));
  console.log("Whale-Sim CLI");
  console.log(`Seed: ${seed}`);
  console.log("=".repeat(88));
}

function printHelp(): void {
  console.log(`
Commands:
  home/status                 Fund state and market regime
  market/m                    Market overview table
  stock/s STOCK_ID            Stock detail with depth, holder, retail, and position info
  portfolio/p                 Holdings, T+1 locked shares, resting cash
  news                        Active news
  whales/w                    Whale roster, strategy, cooldown, and inventory summary
  events [N]                  Recent event log
  trace STOCK_ID [N]          Recent per-tick trace table for one stock
  next/n                      Advance one phase or one tick
  advance/a N                 Advance N ticks/phases, max 60
  buy/b STOCK_ID AMOUNT       Visible market buy. Example: buy DRAGON_SOFT 20m
  sell STOCK_ID SHARES        Market sell sellable shares. Example: sell DRAGON_SOFT 50000
  debug cash AMOUNT           Set cash. Example: debug cash 500m
  debug addcash AMOUNT        Add/subtract cash. Example: debug addcash -20m
  debug pos STOCK TOTAL [SELLABLE] [LOCKED] [AVG]
                              Set a position. Example: debug pos GOLDEN_ROOF 5000000 5000000 0 6.4
  debug addpos STOCK SHARES [AVG]
                              Add shares as sellable. Example: debug addpos DRAGON_SOFT 1000000 18.6
  debug unlock STOCK|all      Move locked shares to sellable
  debug clearpos STOCK        Remove one position
  help/h/?                    Show this help
  quit/q                      Exit

Trading is currently available during intraday and closingAuction phases. Use "next" twice at
the start of a day to enter intraday trading.
`);
}

function printHome(state: GameState): void {
  const player = state.player;
  console.log("\nFund");
  console.log(
    [
      `Day ${state.day}/30`,
      `Tick ${state.tick}/60`,
      `Phase ${state.phase}`,
      `Cash ${money(player.cash)}`,
      `Reserved ${money(getReservedCash(state))}`,
      `Net ${money(player.netWorth)}`,
      `Realized ${money(player.realizedPnl)}`,
      `Unrealized ${money(player.unrealizedPnl)}`,
      `Heat ${player.accountHeat.toFixed(1)}`
    ].join(" | ")
  );
  console.log(
    `Market: ${state.market.regime} sentiment=${state.market.sentiment} liquidity=${state.market.liquidity} volatility=${state.market.volatility} regulator=${state.market.regulatorStrictness}`
  );
}

function printMarket(state: GameState): void {
  printHome(state);
  console.log("\nMarket");
  console.log(
    [
      pad("ID", 18),
      pad("Name", 24),
      pad("Cap", 6),
      pad("Price", 8),
      pad("Chg%", 7),
      pad("Board", 16),
      pad("Depth", 10),
      pad("Attn", 5),
      pad("Sent", 5),
      pad("Heat", 5)
    ].join(" ")
  );

  for (const stock of Object.values(state.stocks)) {
    const chg = ((stock.price - stock.previousClose) / stock.previousClose) * 100;
    console.log(
      [
        pad(stock.id, 18),
        pad(stock.name, 24),
        pad(getMarketCapClass(stock), 6),
        pad(stock.price.toFixed(2), 8),
        pad(chg.toFixed(2), 7),
        pad(stock.boardState, 16),
        pad(moneyShort(calculateEffectiveDepth(stock)), 10),
        pad(stock.attention.toFixed(0), 5),
        pad(stock.sentiment.toFixed(0), 5),
        pad(stock.heat.toFixed(0), 5)
      ].join(" ")
    );
  }
}

function printStockDetail(state: GameState, stock: Stock): void {
  const position = state.player.positions[stock.id];
  const resting = state.player.activeOrders.filter((order) => order.stockId === stock.id);
  const recentTrace = [...recentResults].reverse().map((result) => result.stocks.find((trace) => trace.stockId === stock.id)).find(Boolean);

  console.log(`\n${stock.id} - ${stock.name}`);
  console.log(
    `Sector=${stock.sector} board=${stock.boardType} cap=${getMarketCapClass(stock)} marketCap=${moneyShort(stock.marketCap)} float=${stock.floatShares.toLocaleString()}`
  );
  console.log(
    `Price=${stock.price.toFixed(2)} prev=${stock.previousClose.toFixed(2)} high=${stock.high.toFixed(2)} low=${stock.low.toFixed(
      2
    )} change=${(((stock.price - stock.previousClose) / stock.previousClose) * 100).toFixed(2)}%`
  );
  console.log(
    `State=${stock.boardState} boardStrength=${stock.boardStrength.toFixed(1)} buyQueue=${moneyShort(stock.buyQueue)} sellQueue=${moneyShort(
      stock.sellQueue
    )}`
  );
  console.log(
    `Liquidity=${moneyShort(stock.currentLiquidity)} effectiveDepth=${moneyShort(calculateEffectiveDepth(stock))} attention=${stock.attention.toFixed(
      0
    )} sentiment=${stock.sentiment.toFixed(0)} heat=${stock.heat.toFixed(0)}`
  );
  console.log(
    `Fundamentals PE=${stock.pe.toFixed(1)} fairPE=${stock.fairPe.toFixed(1)} profit=${moneyShort(stock.netProfit)} growth=${stock.profitGrowth.toFixed(
      1
    )}% health=${stock.financialHealth}`
  );
  console.log(
    `Retail greed=${stock.retail.greed.toFixed(0)} fear=${stock.retail.fear.toFixed(0)} faith=${stock.retail.boardFaith.toFixed(
      0
    )} panic=${stock.retail.panicSellers.toFixed(0)} quant=${stock.quantPresence} inst=${stock.institutionPresence}`
  );
  console.log(
    `Position shares=${position?.totalShares.toLocaleString() ?? "0"} sellable=${position?.sellableShares.toLocaleString() ?? "0"} locked=${
      position?.lockedShares.toLocaleString() ?? "0"
    } avgCost=${position?.avgCost.toFixed(2) ?? "-"}`
  );

  if (resting.length > 0) {
    console.log("Resting player orders:");
    for (const order of resting) {
      console.log(
        `  ${order.id} ${order.side} ${money(order.amountCash ?? 0)} ticks=${order.remainingTicks ?? 0} visibility=${order.visibility.toFixed(1)}`
      );
    }
  }

  if (recentTrace) {
    console.log(
      `Last trace: depth=${moneyShort(recentTrace.effectiveDepth)} bid=${moneyShort(recentTrace.bidNotional)} ask=${moneyShort(
        recentTrace.askNotional
      )} buyPressure=${moneyShort(recentTrace.pressure.buyPressure)} sellPressure=${moneyShort(recentTrace.pressure.sellPressure)}`
    );
    if (recentTrace.whaleTrades.length > 0) {
      console.log("Last whale trades:");
      for (const fill of recentTrace.whaleTrades) {
        console.log(
          `  ${fill.ownerName} ${fill.side} ${fill.filledShares.toLocaleString()} shares avg=${fill.avgPrice.toFixed(2)} intent=${fill.intention}`
        );
      }
    }
    if (recentTrace.heatCauses.length > 0) {
      console.log("Last heat causes:");
      for (const cause of [...recentTrace.heatCauses].sort((a, b) => getHeatCauseScore(b) - getHeatCauseScore(a)).slice(0, 5)) {
        console.log(
          `  ${pad(cause.source, 11)} heat=${signed(cause.heatDelta)} sent=${formatOptionalDelta(cause.sentimentDelta)} attn=${formatOptionalDelta(
            cause.attentionDelta
          )} buy=${moneyShort(cause.buyPressure ?? 0)} sell=${moneyShort(cause.sellPressure ?? 0)} | ${cause.note}`
        );
      }
    }
  }
}

function printPortfolio(state: GameState): void {
  printHome(state);
  console.log("\nPortfolio");
  const positions = Object.values(state.player.positions).filter(Boolean);
  if (positions.length === 0) {
    console.log("No positions.");
  } else {
    console.log(
      [pad("Stock", 18), pad("Shares", 12), pad("Sellable", 12), pad("Locked", 12), pad("Avg", 8), pad("Price", 8), pad("UPnL", 12)].join(
        " "
      )
    );
    for (const position of positions) {
      if (!position) continue;
      const stock = state.stocks[position.stockId];
      const upnl = (stock.price - position.avgCost) * position.totalShares;
      console.log(
        [
          pad(position.stockId, 18),
          pad(position.totalShares.toLocaleString(), 12),
          pad(position.sellableShares.toLocaleString(), 12),
          pad(position.lockedShares.toLocaleString(), 12),
          pad(position.avgCost.toFixed(2), 8),
          pad(stock.price.toFixed(2), 8),
          pad(money(upnl), 12)
        ].join(" ")
      );
    }
  }

  if (state.player.activeOrders.length > 0) {
    console.log("\nResting orders");
    for (const order of state.player.activeOrders) {
      console.log(
        `${order.id} ${order.stockId} ${order.side} reserved=${money(order.amountCash ?? 0)} ticks=${order.remainingTicks ?? 0} visibility=${order.visibility.toFixed(
          1
        )}`
      );
    }
  }
}

function printNews(state: GameState): void {
  console.log("\nActive news");
  if (state.news.length === 0) {
    console.log("No active news.");
    return;
  }

  for (const item of state.news) {
    const polarity = item.polarity > 0 ? "positive" : item.polarity < 0 ? "negative" : "neutral";
    console.log(
      `${item.id}: ${item.title} | ${polarity} strength=${item.strength} credibility=${item.credibility} target=${item.targetId ?? item.scope} days=${item.remainingDays}`
    );
  }
}

function printWhales(state: GameState): void {
  const now = getAbsoluteTick(state);

  console.log("\nWhales");
  console.log(
    [
      pad("Name", 24),
      pad("Archetype", 17),
      pad("Cash", 10),
      pad("Inv", 10),
      pad("PnL", 10),
      pad("Intent", 10),
      pad("Target", 18),
      pad("CD", 4)
    ].join(" ")
  );

  for (const whale of state.whales) {
    const inventoryValue = Object.entries(whale.positions).reduce((total, [stockId, shares]) => {
      const stock = state.stocks[stockId as StockId];
      return total + (stock ? stock.price * (shares ?? 0) : 0);
    }, 0);
    const cooldown = Math.max(0, (whale.nextActionTick ?? 0) - now);
    console.log(
      [
        pad(whale.name, 24),
        pad(whale.archetype, 17),
        pad(moneyShort(whale.cash), 10),
        pad(moneyShort(inventoryValue), 10),
        pad(moneyShort(whale.realizedPnl + whale.unrealizedPnl), 10),
        pad(whale.intention, 10),
        pad(whale.targetStockId ?? "-", 18),
        pad(cooldown.toFixed(0), 4)
      ].join(" ")
    );
    const positionRows = Object.entries(whale.positions)
      .filter(([, shares]) => (shares ?? 0) > 0)
      .slice(0, 3)
      .map(([stockId, shares]) => {
        const stock = state.stocks[stockId as StockId];
        const avgCost = whale.avgCostByStock[stockId as StockId] ?? stock.price;
        const pnlPct = avgCost > 0 ? ((stock.price / avgCost - 1) * 100).toFixed(1) : "0.0";
        return `${stockId} ${shares?.toLocaleString()} avg=${avgCost.toFixed(2)} pnl=${pnlPct}%`;
      });
    if (positionRows.length > 0) {
      console.log(`  Holdings: ${positionRows.join(" | ")}`);
    }
    if (whale.strategyNote) {
      console.log(`  ${whale.strategyNote}`);
    }
  }
}

function printTickSummary(result: TickResult): void {
  if (result.stocks.length === 0) {
    printEvents(result.events);
    return;
  }

  const playerFills = result.playerFills.filter((fill) => fill.filledShares > 0);
  const whaleTrades = result.whaleTrades.filter((fill) => fill.filledShares > 0);

  if (playerFills.length > 0) {
    console.log("Player fills");
    for (const fill of playerFills) {
      console.log(
        `  ${fill.stockId} ${fill.side} shares=${fill.filledShares.toLocaleString()} notional=${money(fill.filledNotional)} avg=${fill.avgPrice.toFixed(
          2
        )} unfilledCash=${money(fill.unfilledCash)} unfilledShares=${fill.unfilledShares.toLocaleString()}`
      );
    }
  }

  const notableStocks = result.stocks
    .filter((stock) => Math.abs(stock.priceAfter - stock.priceBefore) > 0.01 || stock.playerFills.length || stock.whaleTrades.length)
    .slice(0, 8);

  if (notableStocks.length > 0) {
    console.log("Tick market");
    for (const stock of notableStocks) {
      const resting = stock.restingOrders.reduce((total, order) => total + order.remainingCash, 0);
      console.log(
        `  ${stock.stockId} ${stock.priceBefore.toFixed(2)} -> ${stock.priceAfter.toFixed(2)} ${stock.changePct.toFixed(2)}% ${
          stock.boardState
        } depth=${moneyShort(stock.effectiveDepth)} resting=${moneyShort(resting)}`
      );
    }
  }

  if (whaleTrades.length > 0) {
    console.log("Whale trades");
    for (const fill of whaleTrades.slice(0, 6)) {
      console.log(
        `  ${fill.ownerName} ${fill.side} ${fill.stockId} shares=${fill.filledShares.toLocaleString()} avg=${fill.avgPrice.toFixed(
          2
        )} intent=${fill.intention}`
      );
    }
  }

  printEvents(result.events.slice(-8));
}

function printEvents(events: GameEvent[]): void {
  if (events.length === 0) {
    console.log("No new events.");
    return;
  }

  console.log("Events");
  for (const event of events) {
    console.log(`  [D${event.day} T${event.tick}] ${event.message}`);
  }
}

function getHeatCauseScore(cause: TickResult["stocks"][number]["heatCauses"][number]): number {
  return (
    Math.abs(cause.heatDelta) * 1_000_000 +
    Math.abs(cause.sentimentDelta ?? 0) * 600_000 +
    Math.abs(cause.attentionDelta ?? 0) * 400_000 +
    Math.max(cause.buyPressure ?? 0, cause.sellPressure ?? 0)
  );
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function formatOptionalDelta(value: number | undefined): string {
  return value === undefined ? "-" : signed(value);
}

function handleDebugCommand(args: string[]): void {
  const [subcommand = "", ...rest] = args;
  const normalized = subcommand.toLowerCase();

  if (!normalized || normalized === "help") {
    printDebugHelp();
    return;
  }

  if (normalized === "cash") {
    const amount = parseSignedMoney(rest[0]);
    if (!Number.isFinite(amount)) {
      console.log("Usage: debug cash AMOUNT. Example: debug cash 500m");
      return;
    }
    game.player.cash = amount;
    recalculatePlayerNetWorth(game);
    console.log(`Debug: cash set to ${money(game.player.cash)}.`);
    printHome(game);
    return;
  }

  if (normalized === "addcash") {
    const amount = parseSignedMoney(rest[0]);
    if (!Number.isFinite(amount)) {
      console.log("Usage: debug addcash AMOUNT. Example: debug addcash -20m");
      return;
    }
    game.player.cash += amount;
    recalculatePlayerNetWorth(game);
    console.log(`Debug: cash changed by ${money(amount)}; cash is now ${money(game.player.cash)}.`);
    printHome(game);
    return;
  }

  if (normalized === "pos") {
    const stock = resolveStock(rest[0]);
    const totalShares = parseNonNegativeInt(rest[1], Number.NaN);
    if (!stock || !Number.isFinite(totalShares)) {
      console.log("Usage: debug pos STOCK TOTAL [SELLABLE] [LOCKED] [AVG]");
      return;
    }

    const sellableShares = parseNonNegativeInt(rest[2], totalShares);
    const lockedShares = parseNonNegativeInt(rest[3], Math.max(0, totalShares - sellableShares));
    const avgCost = parsePositiveNumber(rest[4], stock.price);
    setPosition(stock.id, totalShares, sellableShares, lockedShares, avgCost);
    console.log(
      `Debug: ${stock.id} position set total=${totalShares.toLocaleString()} sellable=${sellableShares.toLocaleString()} locked=${lockedShares.toLocaleString()} avg=${avgCost.toFixed(
        2
      )}.`
    );
    printPortfolio(game);
    return;
  }

  if (normalized === "addpos") {
    const stock = resolveStock(rest[0]);
    const shares = parseSignedInt(rest[1], Number.NaN);
    if (!stock || !Number.isFinite(shares) || shares === 0) {
      console.log("Usage: debug addpos STOCK SHARES [AVG]");
      return;
    }

    const position = getOrCreatePosition(game, stock.id);
    const avgCost = parsePositiveNumber(rest[2], position.avgCost > 0 ? position.avgCost : stock.price);
    if (shares > 0) {
      const oldCostBasis = position.avgCost * position.totalShares;
      position.totalShares += shares;
      position.sellableShares += shares;
      position.avgCost = (oldCostBasis + shares * avgCost) / position.totalShares;
    } else {
      const removed = Math.min(Math.abs(shares), position.totalShares);
      position.totalShares -= removed;
      position.sellableShares = Math.max(0, position.sellableShares - removed);
      if (position.totalShares === 0) {
        delete game.player.positions[stock.id];
      }
    }
    recalculatePlayerNetWorth(game);
    console.log(`Debug: ${stock.id} position changed by ${shares.toLocaleString()} shares.`);
    printPortfolio(game);
    return;
  }

  if (normalized === "unlock") {
    const target = rest[0]?.toLowerCase();
    if (!target) {
      console.log("Usage: debug unlock STOCK|all");
      return;
    }

    const positions =
      target === "all"
        ? Object.values(game.player.positions).filter(Boolean)
        : [resolveStock(rest[0]) ? game.player.positions[resolveStock(rest[0])!.id] : undefined].filter(Boolean);

    for (const position of positions) {
      if (!position) continue;
      position.sellableShares += position.lockedShares;
      position.lockedShares = 0;
    }
    recalculatePlayerNetWorth(game);
    console.log(`Debug: unlocked ${target}.`);
    printPortfolio(game);
    return;
  }

  if (normalized === "clearpos") {
    const stock = resolveStock(rest[0]);
    if (!stock) {
      console.log("Usage: debug clearpos STOCK");
      return;
    }
    delete game.player.positions[stock.id];
    recalculatePlayerNetWorth(game);
    console.log(`Debug: cleared ${stock.id} position.`);
    printPortfolio(game);
    return;
  }

  console.log(`Unknown debug command: ${subcommand}. Type "debug help".`);
}

function printDebugHelp(): void {
  console.log(`
Debug commands:
  debug cash AMOUNT                 Set cash
  debug addcash AMOUNT              Add/subtract cash
  debug pos STOCK TOTAL [SELLABLE] [LOCKED] [AVG]
                                    Set total/sellable/locked shares and average cost
  debug addpos STOCK SHARES [AVG]   Add sellable shares, or remove if SHARES is negative
  debug unlock STOCK|all            Convert locked shares to sellable
  debug clearpos STOCK              Remove a position
`);
}

function setPosition(stockId: StockId, totalShares: number, sellableShares: number, lockedShares: number, avgCost: number): void {
  const normalizedTotal = Math.max(0, Math.floor(totalShares));
  const normalizedSellable = Math.max(0, Math.floor(sellableShares));
  const normalizedLocked = Math.max(0, Math.floor(lockedShares));

  if (normalizedTotal <= 0) {
    delete game.player.positions[stockId];
    recalculatePlayerNetWorth(game);
    return;
  }

  const scale =
    normalizedSellable + normalizedLocked > normalizedTotal
      ? normalizedTotal / Math.max(1, normalizedSellable + normalizedLocked)
      : 1;

  game.player.positions[stockId] = {
    stockId,
    totalShares: normalizedTotal,
    sellableShares: Math.floor(normalizedSellable * scale),
    lockedShares: Math.floor(normalizedLocked * scale),
    avgCost,
    realizedPnl: game.player.positions[stockId]?.realizedPnl ?? 0
  };
  recalculatePlayerNetWorth(game);
}

function resolveStock(inputId?: string): Stock | undefined {
  if (!inputId) {
    console.log("Missing stock id. Use 'market' to see ids.");
    return undefined;
  }

  const upper = inputId.toUpperCase();
  const byId = game.stocks[upper as StockId];
  if (byId) return byId;

  const byPrefix = Object.values(game.stocks).find((stock) => stock.id.startsWith(upper));
  if (byPrefix) return byPrefix;

  console.log(`Unknown stock: ${inputId}. Use 'market' to see ids.`);
  return undefined;
}

function canTrade(): boolean {
  if (game.phase === "intraday" || game.phase === "closingAuction") return true;
  console.log(`Trading commands are not active during ${game.phase}. Use "next" to reach intraday.`);
  return false;
}

function parseMoney(value?: string): number {
  if (!value) return 0;
  const trimmed = value.trim().toLowerCase().replace(/,/g, "");
  const match = trimmed.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!match) return 0;
  const amount = Number(match[1]);
  const suffix = match[2];
  if (suffix === "k") return amount * 1_000;
  if (suffix === "m") return amount * 1_000_000;
  if (suffix === "b") return amount * 1_000_000_000;
  return amount;
}

function parseSignedMoney(value?: string): number {
  if (!value) return Number.NaN;
  const trimmed = value.trim().toLowerCase().replace(/,/g, "");
  const match = trimmed.match(/^([+-]?\d+(?:\.\d+)?)([kmb])?$/);
  if (!match) return Number.NaN;
  const amount = Number(match[1]);
  const suffix = match[2];
  if (suffix === "k") return amount * 1_000;
  if (suffix === "m") return amount * 1_000_000;
  if (suffix === "b") return amount * 1_000_000_000;
  return amount;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value.replace(/,/g, ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value.replace(/,/g, ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseSignedInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value.replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getAbsoluteTick(state: GameState): number {
  return (state.day - 1) * GAME_CONFIG.ticksPerDay + state.tick;
}
