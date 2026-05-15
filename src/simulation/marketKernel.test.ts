import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../game/config";
import { createInitialGame } from "../game/createInitialGame";
import { updateValuationFromPrice } from "../game/fundamentals";
import { setBoardQueue } from "./boardQueueLedger";
import { getLowerLimit, getUpperLimit, updateBoardState } from "./boardEngine";
import { calculateFundamentalPressure } from "./fundamentalEngine";
import { createMarketDepth, executeBuyFromDepth, executeSellIntoDepth } from "./marketDepth";
import { getMarketMemory } from "./marketMemory";
import { createPressure } from "./priceEngine";
import { advanceToIntraday, findStockTrace } from "./scenarioTools";
import { calculateShrimpCollectivePressure } from "./shrimpCollectiveEngine";
import { updateTick as updateTickBase } from "./tick";

function updateTick(game: Parameters<typeof updateTickBase>[0], playerActions: Parameters<typeof updateTickBase>[1] = []) {
  return updateTickBase(game, playerActions, { detail: "full" });
}

function updateTickSummary(game: Parameters<typeof updateTickBase>[0], playerActions: Parameters<typeof updateTickBase>[1] = []) {
  return updateTickBase(game, playerActions);
}
import { createWhaleOrders } from "./whaleEngine";

describe("headless market kernel", () => {
  it("locks same-day buys under T+1 and unlocks after settlement", () => {
    const game = createInitialGame("t-plus-one-test");

    updateTick(game);
    updateTick(game);
    expect(game.phase).toBe("intraday");

    updateTick(game, [{ type: "marketBuy", stockId: "DRAGON_SOFT", amountCash: 10_000_000 }]);

    const intradayPosition = game.player.positions.DRAGON_SOFT;
    expect(intradayPosition).toBeDefined();
    expect(intradayPosition?.totalShares).toBeGreaterThan(0);
    expect(intradayPosition?.lockedShares).toBe(intradayPosition?.totalShares);
    expect(intradayPosition?.sellableShares).toBe(0);

    while (game.phase === "intraday") {
      updateTick(game);
    }
    updateTick(game);

    const settledPosition = game.player.positions.DRAGON_SOFT;
    expect(game.day).toBe(2);
    expect(game.phase).toBe("preMarket");
    expect(settledPosition?.lockedShares).toBe(0);
    expect(settledPosition?.sellableShares).toBe(settledPosition?.totalShares);
  });

  it("keeps prices inside daily board limits", () => {
    const game = createInitialGame("limit-test");

    updateTick(game);
    updateTick(game);

    for (let i = 0; i < 10; i += 1) {
      updateTick(game, [{ type: "marketBuy", stockId: "DRAGON_SOFT", amountCash: 25_000_000 }]);
    }

    for (const stock of Object.values(game.stocks)) {
      expect(stock.price).toBeLessThanOrEqual(getUpperLimit(stock));
      expect(stock.price).toBeGreaterThanOrEqual(getLowerLimit(stock));
    }
  });

  it("makes market cap visible in same-notional price impact", () => {
    const game = createInitialGame("cap-impact-test");
    advanceToIntraday(game);

    const result = updateTick(game, [
      { type: "marketBuy", stockId: "GOLDEN_ROOF", amountCash: 20_000_000 },
      { type: "marketBuy", stockId: "HARBOR_BANK", amountCash: 20_000_000 }
    ]);
    const smallCap = findStockTrace(result, "GOLDEN_ROOF");
    const largeCap = findStockTrace(result, "HARBOR_BANK");

    expect(smallCap.marketCapClass).toBe("small");
    expect(largeCap.marketCapClass).toBe("large");
    expect(smallCap.effectiveDepth).toBeLessThan(largeCap.effectiveDepth);
    expect(smallCap.playerFills[0]?.liquidityTakenPct ?? 0).toBeGreaterThan(
      largeCap.playerFills[0]?.liquidityTakenPct ?? 0
    );
  });

  it("partially fills oversized buys and reserves unfilled cash as resting interest", () => {
    const game = createInitialGame("partial-fill-test");
    advanceToIntraday(game);

    const result = updateTick(game, [{ type: "marketBuy", stockId: "GOLDEN_ROOF", amountCash: 100_000_000 }]);
    const trace = findStockTrace(result, "GOLDEN_ROOF");
    const fill = trace.playerFills[0];

    expect(fill.filledNotional).toBeGreaterThan(0);
    expect(fill.unfilledCash).toBeGreaterThan(1_000_000);
    expect(trace.restingOrders[0]?.remainingCash).toBeCloseTo(fill.unfilledCash, 2);
    expect(game.player.cash).toBe(GAME_CONFIG.startingCash - 100_000_000);
    expect(game.player.activeOrders[0]?.amountCash).toBeCloseTo(fill.unfilledCash, 2);
    expect(game.stocks.GOLDEN_ROOF.price).toBeLessThanOrEqual(getUpperLimit(game.stocks.GOLDEN_ROOF));
  });

  it("continues resting buy interest on later ticks and only locks filled shares", () => {
    const game = createInitialGame("resting-order-test");
    advanceToIntraday(game);

    const first = updateTick(game, [{ type: "marketBuy", stockId: "GOLDEN_ROOF", amountCash: 100_000_000 }]);
    const firstTrace = findStockTrace(first, "GOLDEN_ROOF");
    const firstPosition = game.player.positions.GOLDEN_ROOF;
    const firstLockedShares = firstPosition?.lockedShares ?? 0;
    const firstTotalShares = firstPosition?.totalShares ?? 0;
    const firstResting = firstTrace.restingOrders[0]?.remainingCash ?? 0;

    const second = updateTick(game);
    const secondTrace = findStockTrace(second, "GOLDEN_ROOF");
    const secondPosition = game.player.positions.GOLDEN_ROOF;

    expect(firstLockedShares).toBe(firstTotalShares);
    expect(firstResting).toBeGreaterThan(0);
    expect(secondTrace.restingOrders[0]?.remainingCash ?? 0).toBeLessThanOrEqual(firstResting);
    expect(secondTrace.restingOrders[0]?.remainingCash ?? 0).toBeGreaterThanOrEqual(0);
    expect(secondPosition?.lockedShares).toBe(secondPosition?.totalShares);
  });

  it("includes whale response and rich stock data in structured traces", () => {
    const game = createInitialGame("whale-response-test");
    advanceToIntraday(game);

    const result = updateTick(game, [{ type: "marketBuy", stockId: "NEW_HORIZON_BIO", amountCash: 30_000_000 }]);
    const trace = findStockTrace(result, "NEW_HORIZON_BIO");

    expect(trace.playerFills[0]?.filledNotional).toBeGreaterThan(0);
    expect(result.whaleTrades.length).toBeGreaterThan(0);
    expect(result.whaleTrades.some((trade) => trade.ownerName)).toBe(true);
    expect(trace.currentLiquidity).toBeGreaterThan(0);
    expect(trace.effectiveDepth).toBeGreaterThan(0);
    expect(trace.pressure.buyPressure).toBeGreaterThan(0);
    expect(trace.pressure.sellPressure).toBeGreaterThan(0);
    expect(trace.heatCauses.some((cause) => cause.source === "player")).toBe(true);
    expect(trace.heatCauses.some((cause) => cause.source === "collective" || cause.source === "fundamental")).toBe(true);
    expect(result.events.some((event) => event.type === "whaleTrade")).toBe(true);
  });

  it("lets quant selling break a weak board", () => {
    const game = createInitialGame("weak-board-break-test");
    advanceToIntraday(game);
    const stock = game.stocks.DRAGON_SOFT;

    stock.price = getUpperLimit(stock);
    stock.boardState = "weakSeal";
    stock.buyQueue = 0;
    stock.boardStrength = 20;
    stock.quantPresence = 100;
    stock.heat = 95;
    stock.retail.fear = 90;
    stock.retail.panicSellers = 90;
    stock.retail.greed = 10;

    const result = updateTick(game);
    const trace = findStockTrace(result, "DRAGON_SOFT");

    expect(trace.pressure.quantSellPressure).toBeGreaterThan(trace.pressure.quantBuyPressure);
    expect(["brokenBoard", "panic", "limitDown"]).toContain(trace.boardState);
    expect(trace.boardState).not.toBe("weakSeal");
  });

  it("does not let tiny buys walk the next price level", () => {
    const game = createInitialGame("tiny-order-depth-test");
    const stock = game.stocks.GOLDEN_ROOF;
    const depth = createMarketDepth(stock, { buyPressure: 0, sellPressure: 0 });

    const fill = executeBuyFromDepth(stock, depth, 111, "player");

    expect(fill.filledShares).toBeGreaterThan(0);
    expect(fill.finalPrice).toBe(stock.price);
    expect(fill.liquidityTakenPct).toBeLessThan(0.01);
  });

  it("prints ambient tape even when no player or whale trades occur", () => {
    const game = createInitialGame("ambient-tape-test");
    advanceToIntraday(game);

    updateTick(game);

    for (const stock of Object.values(game.stocks)) {
      expect(stock.turnover).toBeGreaterThan(0);
      expect(stock.volume).toBeGreaterThan(0);
    }
  });

  it("prints jagged intraday tape instead of a straight pressure ramp", () => {
    const game = createInitialGame("combat-path-test");
    advanceToIntraday(game);
    const stock = game.stocks.SKY_SHIELD;
    const path = [stock.price];

    for (let i = 0; i < 150; i += 1) {
      updateTick(game);
      path.push(stock.price);
    }

    const stats = countTapeTurns(path);

    expect(stats.nonzeroTicks).toBeGreaterThan(40);
    expect(stats.turns).toBeGreaterThan(20);
    expect(stats.maxSameDirectionRun).toBeLessThan(20);
  });

  it("leaves tape stress and follow-through after a large visible buy", () => {
    const game = createInitialGame("execution-repercussion-test");
    advanceToIntraday(game);
    const stock = game.stocks.EAST_GRID_ENERGY;
    const heatBefore = stock.heat;
    const attentionBefore = stock.attention;

    const result = updateTick(game, [{ type: "marketBuy", stockId: "EAST_GRID_ENERGY", amountCash: 120_000_000 }]);
    const trace = findStockTrace(result, "EAST_GRID_ENERGY");
    const stressAfterFill = stock.microstructure.liquidityStress;
    const flowAfterFill = stock.microstructure.flowMemory;

    expect(trace.playerFills[0]?.filledNotional).toBeGreaterThan(100_000_000);
    expect(stressAfterFill).toBeGreaterThan(6);
    expect(flowAfterFill).toBeGreaterThan(4);
    expect(stock.heat).toBeGreaterThan(heatBefore);
    expect(stock.attention).toBeGreaterThan(attentionBefore);

    for (let i = 0; i < 12; i += 1) {
      updateTick(game);
    }

    expect(stock.microstructure.liquidityStress).toBeGreaterThan(2);
  });

  it("keeps whale-free post-board trading contested by shrimp cohorts", () => {
    const game = createInitialGame("whale-free-after-board-test");
    game.whales = [];
    advanceToIntraday(game);

    for (let i = 0; i < 8; i += 1) {
      updateTick(game, [{ type: "marketBuy", stockId: "DRAGON_SOFT", amountCash: 120_000_000 }]);
    }
    while (game.phase !== "preMarket" || game.day < 2) {
      updateTick(game);
    }
    advanceToIntraday(game);

    const stock = game.stocks.DRAGON_SOFT;
    const path = [stock.price];
    for (let i = 0; i < 120; i += 1) {
      updateTick(game);
      path.push(stock.price);
    }

    const stats = countTapeTurns(path);

    expect(stats.turns).toBeGreaterThan(22);
    expect(stats.maxSameDirectionRun).toBeLessThan(18);
    expect(stock.shrimpCohorts.find((cohort) => cohort.strategy === "boardChaser")?.capital ?? 0).toBeGreaterThan(10_000_000);
  });

  it("ignores deep nonmarketable buy spam as a price signal", () => {
    const baseline = createInitialGame("deep-nonmarketable-bid-test");
    const spam = createInitialGame("deep-nonmarketable-bid-test");

    for (const game of [baseline, spam]) {
      game.whales = [];
      advanceToIntraday(game);
      const stock = game.stocks.DRAGON_SOFT;
      stock.previousClose = 24.5;
      stock.open = 24.5;
      stock.price = 29;
      stock.microPrice = 29;
      stock.high = 29;
      stock.low = 24.5;
      stock.boardState = "attackingLimitUp";
      stock.buyQueue = 0;
      stock.sellQueue = 0;
      stock.currentLiquidity = 12_900_000;
      stock.heat = 80;
      stock.attention = 90;
      stock.retail.greed = 90;
      stock.retail.boardFaith = 90;
    }

    let maxPlayerBuyPressure = 0;
    let maxVisibility = 0;
    let maxFill = 0;
    for (let i = 0; i < 12; i += 1) {
      updateTick(baseline);
      const result = updateTick(spam, [{ type: "marketBuy", stockId: "DRAGON_SOFT", amountCash: 245_000_000, limitPrice: 24.5 }]);
      const trace = findStockTrace(result, "DRAGON_SOFT");
      maxPlayerBuyPressure = Math.max(maxPlayerBuyPressure, trace.pressure.playerBuyPressure);
      maxVisibility = Math.max(maxVisibility, ...trace.restingOrders.map((order) => order.visibility));
      maxFill = Math.max(maxFill, trace.playerFills[0]?.filledNotional ?? 0);
    }

    expect(maxFill).toBe(0);
    expect(maxVisibility).toBe(0);
    expect(maxPlayerBuyPressure).toBe(0);
    expect(spam.stocks.DRAGON_SOFT.buyQueue).toBe(0);
    expect(spam.stocks.DRAGON_SOFT.price).toBeCloseTo(baseline.stocks.DRAGON_SOFT.price, 2);
  });

  it("creates bursty whale-free panic instead of a constant down-slope", () => {
    const game = createInitialGame("whale-free-panic-cascade-test");
    game.whales = [];
    advanceToIntraday(game);
    const stock = game.stocks.NEW_HORIZON_BIO;

    stock.previousClose = 16.02;
    stock.open = 14.94;
    stock.price = 14.94;
    stock.microPrice = 14.94;
    stock.high = 16;
    stock.low = 14.94;
    stock.boardState = "panic";
    stock.retail.fear = 92;
    stock.retail.panicSellers = 90;
    stock.retail.greed = 8;
    stock.retail.dipBuyers = 22;
    stock.momentum = -65;
    stock.heat = 75;
    stock.attention = 80;
    stock.microstructure.flowMemory = -35;
    stock.microstructure.liquidityStress = 55;
    stock.buyQueue = 0;
    stock.sellQueue = 0;

    const path = [stock.price];
    for (let i = 0; i < 80; i += 1) {
      updateTick(game);
      path.push(stock.price);
    }

    const stats = countTapeTurns(path);
    const deltaStats = measureTapeDeltas(path);
    const limitTick = path.findIndex((price) => price <= getLowerLimit(stock));

    expect(limitTick).toBeGreaterThan(0);
    expect(limitTick).toBeLessThan(24);
    expect(stock.price).toBe(getLowerLimit(stock));
    expect(stats.nonzeroTicks).toBeGreaterThan(4);
    expect(deltaStats.maxAbsDelta).toBeGreaterThanOrEqual(18);
    expect(deltaStats.distinctAbsMoves).toBeGreaterThanOrEqual(4);
  });

  it("builds visible book levels as contiguous price ticks", () => {
    const game = createInitialGame("contiguous-book-test");
    const stock = game.stocks.HARBOR_BANK;
    const depth = createMarketDepth(stock, { buyPressure: 0, sellPressure: 0 });

    expect(depth.askLevels[1].price - depth.askLevels[0].price).toBeCloseTo(0.01, 2);
    expect(depth.bidLevels[0].price - depth.bidLevels[1].price).toBeCloseTo(0.01, 2);
    expect(depth.askLevels[4].price - depth.askLevels[0].price).toBeCloseTo(0.04, 2);
    expect(depth.bidLevels[0].price - depth.bidLevels[4].price).toBeCloseTo(0.04, 2);
  });

  it("respects player buy limit prices against ask depth", () => {
    const game = createInitialGame("buy-limit-price-test");
    const stock = game.stocks.DRAGON_SOFT;
    const depth = createMarketDepth(stock, { buyPressure: 0, sellPressure: 0 });
    const bestAsk = depth.askLevels[0];
    const secondAsk = depth.askLevels[1];

    const fill = executeBuyFromDepth(stock, depth, 20_000_000, "player", {}, { limitPrice: bestAsk.price });

    expect(fill.filledShares).toBeGreaterThan(0);
    expect(fill.finalPrice).toBeLessThanOrEqual(bestAsk.price);
    expect(depth.askLevels[1].availableNotional).toBe(secondAsk.availableNotional);
    expect(fill.unfilledCash).toBeGreaterThan(0);
  });

  it("respects player sell limit prices against bid depth", () => {
    const game = createInitialGame("sell-limit-price-test");
    const stock = game.stocks.DRAGON_SOFT;
    const depth = createMarketDepth(stock, { buyPressure: 0, sellPressure: 0 });
    const bestBid = depth.bidLevels[0];
    const secondBid = depth.bidLevels[1];

    const fill = executeSellIntoDepth(stock, depth, 1_000_000, "player", {}, { limitPrice: bestBid.price });

    expect(fill.filledShares).toBeGreaterThan(0);
    expect(fill.finalPrice).toBeGreaterThanOrEqual(bestBid.price);
    expect(depth.bidLevels[1].availableNotional).toBe(secondBid.availableNotional);
    expect(fill.unfilledShares).toBeGreaterThan(0);
  });

  it("requires actual buy queue to sell on a limit-down lock", () => {
    const game = createInitialGame("limit-down-liquidity-test");
    advanceToIntraday(game);
    const stock = game.stocks.GOLDEN_ROOF;
    game.player.positions.GOLDEN_ROOF = {
      stockId: "GOLDEN_ROOF",
      totalShares: 5_000_000,
      sellableShares: 5_000_000,
      lockedShares: 0,
      avgCost: stock.price,
      realizedPnl: 0
    };
    stock.price = getLowerLimit(stock);
    stock.boardState = "limitDown";
    stock.buyQueue = 0;
    stock.sellQueue = 50_000_000;

    const result = updateTick(game, [{ type: "marketSell", stockId: "GOLDEN_ROOF", shares: 5_000_000 }]);
    const trace = findStockTrace(result, "GOLDEN_ROOF");

    expect(trace.bidNotional).toBe(0);
    expect(trace.playerFills[0]?.filledShares ?? 0).toBe(0);
    expect(game.player.positions.GOLDEN_ROOF?.sellableShares).toBe(5_000_000);
  });

  it("keeps limit-down prints pinned while the sell queue ledger holds", () => {
    const game = createInitialGame("limit-down-pin-ledger-test");
    advanceToIntraday(game);
    const stock = game.stocks.GOLDEN_ROOF;
    const lowerLimit = getLowerLimit(stock);
    stock.price = lowerLimit;
    stock.open = lowerLimit;
    stock.high = lowerLimit;
    stock.low = lowerLimit;
    stock.microPrice = lowerLimit;
    stock.boardState = "limitDown";
    setBoardQueue(stock, "sell", 50_000_000, { institution: 10_000_000, retail: 40_000_000 });

    const prices: number[] = [];
    for (let tick = 0; tick < 25; tick += 1) {
      updateTick(game);
      prices.push(stock.price);
    }

    expect(new Set(prices)).toEqual(new Set([lowerLimit]));
    expect(stock.boardQueueLedger.sell.lockedTicks).toBeGreaterThan(0);
    expect(stock.boardQueueLedger.sell.quality).toBeGreaterThan(0);
  });

  it("consumes limit-up buy queue instead of replacing it", () => {
    const game = createInitialGame("limit-up-queue-test");
    const stock = game.stocks.DRAGON_SOFT;
    stock.price = getUpperLimit(stock);
    stock.boardState = "sealedLimitUp";
    stock.buyQueue = 1_000_000;
    stock.sellQueue = 0;
    const depth = createMarketDepth(stock, { buyPressure: 0, sellPressure: 0 });

    const fill = executeSellIntoDepth(stock, depth, 1_000, "player");

    expect(fill.filledNotional).toBeGreaterThan(0);
    expect(stock.buyQueue).toBeLessThan(1_000_000);
    expect(stock.buyQueue).toBeCloseTo(1_000_000 - fill.filledNotional, 2);
  });

  it("keeps a well-sealed board stable against a moderate dump", () => {
    const game = createInitialGame("sealed-board-stability-test");
    advanceToIntraday(game);
    game.player.cash = 300_000_000;
    game.player.netWorth = 300_000_000;

    const seal = updateTick(game, [{ type: "marketBuy", stockId: "GOLDEN_ROOF", amountCash: 150_000_000 }]);
    const sealedTrace = findStockTrace(seal, "GOLDEN_ROOF");
    const position = game.player.positions.GOLDEN_ROOF;
    if (position) {
      position.sellableShares = position.totalShares;
      position.lockedShares = 0;
    }

    const dump = updateTick(game, [{ type: "marketSell", stockId: "GOLDEN_ROOF", shares: 2_000_000 }]);
    const dumpTrace = findStockTrace(dump, "GOLDEN_ROOF");

    expect(sealedTrace.boardState).toBe("sealedLimitUp");
    expect(dumpTrace.playerFills.find((fill) => fill.side === "sell")?.avgPrice).toBeCloseTo(getUpperLimit(game.stocks.GOLDEN_ROOF), 2);
    expect(dumpTrace.boardState).toBe("sealedLimitUp");
    expect(dumpTrace.buyQueue).toBeGreaterThan(0);
    expect(dumpTrace.priceAfter).toBe(getUpperLimit(game.stocks.GOLDEN_ROOF));
  });

  it("does not allow buying at limit-up when no one is selling", () => {
    const game = createInitialGame("limit-up-no-sellers-test");
    const stock = game.stocks.DRAGON_SOFT;
    stock.price = getUpperLimit(stock);
    stock.boardState = "sealedLimitUp";
    stock.buyQueue = 10_000_000;
    stock.sellQueue = 0;
    const depth = createMarketDepth(stock, { buyPressure: 10_000_000, sellPressure: 0 });

    const fill = executeBuyFromDepth(stock, depth, 1_000_000, "player");

    expect(depth.askNotional).toBe(0);
    expect(fill.filledShares).toBe(0);
    expect(fill.unfilledCash).toBe(1_000_000);
  });

  it("paces whale actions and allows whales to switch direction", () => {
    const game = createInitialGame("quant-knife-opposition-test");
    advanceToIntraday(game);

    const results = [
      updateTick(game, [{ type: "marketBuy", stockId: "DRAGON_SOFT", amountCash: 30_000_000 }])
    ];
    for (let i = 0; i < 59; i += 1) {
      results.push(updateTick(game));
    }
    const first = results[0];
    const firstTrace = findStockTrace(first, "DRAGON_SOFT");
    const dragonTrades = results.flatMap((result) => findStockTrace(result, "DRAGON_SOFT").whaleTrades);
    const silverNeedleTicks = results
      .filter((result) => findStockTrace(result, "DRAGON_SOFT").whaleTrades.some((fill) => fill.ownerName === "Silver Needle Quant"))
      .map((result) => result.tick);
    const northTowerSides = results
      .flatMap((result) => result.whaleTrades)
      .filter((fill) => fill.ownerName === "North Tower Capital")
      .map((fill) => fill.side);

    expect(firstTrace.whaleTrades.some((fill) => fill.ownerName === "Silver Needle Quant" && fill.side === "sell")).toBe(true);
    expect(silverNeedleTicks.length).toBeGreaterThan(1);
    expect(silverNeedleTicks.length).toBeLessThan(results.length);
    expect(northTowerSides).toContain("buy");
    expect(northTowerSides).toContain("sell");
  });

  it("does not call a shallow dip panic when greed can absorb it", () => {
    const game = createInitialGame("panic-threshold-test");
    const stock = game.stocks.PEARL_DAILY;
    stock.price = stock.previousClose * 0.99;
    stock.retail.fear = 36;
    stock.retail.panicSellers = 28;
    stock.retail.greed = 66;

    const pressure = createPressure(game, stock, {
      retailBuyPressure: 700_000,
      retailSellPressure: 1_500_000,
      noise: 0
    });
    const state = updateBoardState(stock, pressure);

    expect(state).toBe("loose");
  });

  it("adds fundamental resistance to expensive names and support to quality washouts", () => {
    const game = createInitialGame("fundamental-pressure-test");
    const expensive = game.stocks.PEARL_DAILY;
    const washedOut = game.stocks.EAST_GRID_ENERGY;

    expensive.price = expensive.price * 1.75;
    updateValuationFromPrice(expensive);
    expensive.heat = 72;
    expensive.retail.greed = 82;

    washedOut.price = washedOut.price * 0.72;
    updateValuationFromPrice(washedOut);
    washedOut.boardState = "panic";
    washedOut.retail.fear = 78;
    washedOut.retail.panicSellers = 68;

    const expensivePressure = calculateFundamentalPressure(game, expensive);
    const washedOutPressure = calculateFundamentalPressure(game, washedOut);

    expect(expensivePressure.sellPressure).toBeGreaterThan(expensivePressure.buyPressure);
    expect(washedOutPressure.buyPressure).toBeGreaterThan(washedOutPressure.sellPressure);
  });

  it("lets heat and panic fade instead of locking a no-player run into one-way momentum", () => {
    const game = createInitialGame("no-player-momentum-brake-test");
    const initialPrices = Object.fromEntries(Object.values(game.stocks).map((stock) => [stock.id, stock.price]));

    for (let i = 0; i < GAME_CONFIG.ticksPerDay * 12 + 60 && game.phase !== "ended"; i += 1) {
      updateTick(game);
      if (game.phase === "preMarket" && game.tick === 0 && game.day >= 11) break;
    }

    const returns = Object.values(game.stocks).map((stock) => stock.price / initialPrices[stock.id] - 1);
    const maxHeat = Math.max(...Object.values(game.stocks).map((stock) => stock.heat));
    const maxFear = Math.max(...Object.values(game.stocks).map((stock) => stock.retail.fear));
    const lockedStates = Object.values(game.stocks).filter((stock) => stock.boardState === "panic" || stock.boardState === "limitDown");

    expect(Math.min(...returns)).toBeGreaterThan(-0.52);
    expect(Math.max(...returns)).toBeLessThan(0.85);
    expect(maxHeat).toBeLessThan(84);
    expect(maxFear).toBeLessThan(98);
    expect(lockedStates).toHaveLength(0);
  });

  it("tracks whale cost basis and P&L after trades", () => {
    const game = createInitialGame("whale-accounting-test");
    advanceToIntraday(game);

    const result = updateTick(game);
    const whaleFill = result.whaleTrades.find((fill) => fill.side === "buy");
    expect(whaleFill).toBeDefined();

    const whale = game.whales.find((candidate) => candidate.id === whaleFill?.ownerId);
    expect(whale).toBeDefined();
    expect(whale?.avgCostByStock[whaleFill!.stockId]).toBeGreaterThan(0);
    expect(whale?.netWorth).toBeGreaterThan(whale!.cash);
    expect(Number.isFinite(whale?.unrealizedPnl)).toBe(true);
  });

  it("derives multi-day market memory from daily candles and the current tape", () => {
    const game = createInitialGame("market-memory-test");
    const stock = game.stocks.RED_RIVER_LITHIUM;

    stock.dailyCandles = [
      { day: -5, open: 10, high: 10.2, low: 9.8, close: 10, volume: 1, turnover: 1, boardState: "loose" },
      { day: -4, open: 10, high: 10.7, low: 9.9, close: 10.6, volume: 1, turnover: 1, boardState: "loose" },
      { day: -3, open: 10.6, high: 11.3, low: 10.5, close: 11.2, volume: 1, turnover: 1, boardState: "attackingLimitUp" },
      { day: -2, open: 11.2, high: 12, low: 11.1, close: 11.9, volume: 1, turnover: 1, boardState: "sealedLimitUp" },
      { day: -1, open: 11.9, high: 12.9, low: 11.8, close: 12.8, volume: 1, turnover: 1, boardState: "loose" },
      { day: 1, open: 12.8, high: 13.2, low: 12.7, close: 13.1, volume: 1, turnover: 1, boardState: "loose" }
    ];
    stock.price = 13.1;
    stock.previousClose = 12.8;
    stock.chart.push({ day: 1, tick: 1, price: 13.1, boardState: "loose" });

    const memory = getMarketMemory(game, stock);

    expect(memory.return1d).toBeCloseTo(2.34, 1);
    expect(memory.return5d).toBeGreaterThan(25);
    expect(memory.return10d).toBeGreaterThan(25);
    expect(memory.greenDays5d).toBeGreaterThanOrEqual(4);
    expect(memory.limitUpDays5d).toBe(2);
    expect(memory.ma5Deviation).toBeGreaterThan(4);
  });

  it("keeps a losing whale from dumping just because a board is hot", () => {
    const game = createInitialGame("whale-loss-discipline-test");
    advanceToIntraday(game);
    const stock = game.stocks.DRAGON_SOFT;
    const northTower = game.whales.find((whale) => whale.name === "North Tower Capital")!;

    stock.price = 17;
    stock.earningsPerShare = 0.45;
    updateValuationFromPrice(stock);
    stock.heat = 90;
    stock.boardState = "sealedLimitUp";
    stock.buyQueue = 80_000_000;
    northTower.positions.DRAGON_SOFT = 1_000_000;
    northTower.avgCostByStock.DRAGON_SOFT = 22;
    northTower.nextActionTick = 0;

    const orders = createWhaleOrders(game, stock, 15, 30_000_000);
    const northOrder = orders.find((order) => order.whale.id === northTower.id);

    expect(northOrder?.side).not.toBe("sell");
  });

  it("makes whale exits sensitive to multi-day overextension history", () => {
    const flat = createInitialGame("flat-whale-memory-test");
    const extended = createInitialGame("extended-whale-memory-test");

    for (const game of [flat, extended]) {
      advanceToIntraday(game);
      const stock = game.stocks.RED_RIVER_LITHIUM;
      const whale = game.whales.find((candidate) => candidate.name === "Copper Gate Raiders")!;
      game.whales = [whale];
      stock.price = 12.8;
      stock.previousClose = 12.8;
      stock.open = 12.8;
      stock.heat = 28;
      stock.boardState = "loose";
      whale.positions.RED_RIVER_LITHIUM = 1_000_000;
      whale.avgCostByStock.RED_RIVER_LITHIUM = 12.45;
      whale.nextActionTick = 0;
    }

    flat.stocks.RED_RIVER_LITHIUM.dailyCandles = [
      { day: -5, open: 12.7, high: 12.9, low: 12.6, close: 12.8, volume: 1, turnover: 1, boardState: "loose" },
      { day: -4, open: 12.8, high: 12.9, low: 12.6, close: 12.75, volume: 1, turnover: 1, boardState: "loose" },
      { day: -3, open: 12.75, high: 12.9, low: 12.6, close: 12.82, volume: 1, turnover: 1, boardState: "loose" },
      { day: -2, open: 12.82, high: 12.9, low: 12.6, close: 12.78, volume: 1, turnover: 1, boardState: "loose" },
      { day: -1, open: 12.78, high: 12.9, low: 12.6, close: 12.8, volume: 1, turnover: 1, boardState: "loose" },
      { day: 1, open: 12.8, high: 12.8, low: 12.8, close: 12.8, volume: 1, turnover: 1, boardState: "loose" }
    ];
    extended.stocks.RED_RIVER_LITHIUM.dailyCandles = [
      { day: -5, open: 8.2, high: 8.4, low: 8.1, close: 8.3, volume: 1, turnover: 1, boardState: "loose" },
      { day: -4, open: 8.3, high: 9.2, low: 8.2, close: 9.1, volume: 1, turnover: 1, boardState: "loose" },
      { day: -3, open: 9.1, high: 10.2, low: 9, close: 10.1, volume: 1, turnover: 1, boardState: "attackingLimitUp" },
      { day: -2, open: 10.1, high: 11.5, low: 10, close: 11.4, volume: 1, turnover: 1, boardState: "sealedLimitUp" },
      { day: -1, open: 11.4, high: 12.9, low: 11.3, close: 12.8, volume: 1, turnover: 1, boardState: "loose" },
      { day: 1, open: 12.8, high: 12.8, low: 12.8, close: 12.8, volume: 1, turnover: 1, boardState: "loose" }
    ];

    const flatOrders = createWhaleOrders(flat, flat.stocks.RED_RIVER_LITHIUM, 0, 30_000_000);
    const extendedOrders = createWhaleOrders(extended, extended.stocks.RED_RIVER_LITHIUM, 0, 30_000_000);

    expect(flatOrders.some((order) => order.side === "sell")).toBe(false);
    expect(extendedOrders.some((order) => order.side === "sell" && order.intention === "attack")).toBe(true);
  });

  it("lets off-base quant whales distribute a rich staircase when they hold inventory", () => {
    const game = createInitialGame("off-base-whale-runner-test");
    advanceToIntraday(game);
    const stock = game.stocks.PEARL_DAILY;
    const whale = game.whales.find((candidate) => candidate.name === "Copper Gate Raiders")!;
    game.whales = [whale];

    stock.price = 17.8;
    stock.previousClose = 17.8;
    stock.open = 17.8;
    stock.avgHolderCost = 14.2;
    stock.heat = 34;
    stock.boardState = "loose";
    stock.dailyCandles = [
      { day: -5, open: 12.2, high: 12.7, low: 12.1, close: 12.6, volume: 1, turnover: 1, boardState: "loose" },
      { day: -4, open: 12.6, high: 13.5, low: 12.5, close: 13.4, volume: 1, turnover: 1, boardState: "loose" },
      { day: -3, open: 13.4, high: 14.7, low: 13.3, close: 14.6, volume: 1, turnover: 1, boardState: "loose" },
      { day: -2, open: 14.6, high: 16.1, low: 14.5, close: 16, volume: 1, turnover: 1, boardState: "attackingLimitUp" },
      { day: -1, open: 16, high: 17.9, low: 15.9, close: 17.8, volume: 1, turnover: 1, boardState: "loose" },
      { day: 1, open: 17.8, high: 17.8, low: 17.8, close: 17.8, volume: 1, turnover: 1, boardState: "loose" }
    ];
    whale.positions = { PEARL_DAILY: 500_000 };
    whale.avgCostByStock = { PEARL_DAILY: 13.1 };
    whale.nextActionTick = 0;
    updateValuationFromPrice(stock);

    const orders = createWhaleOrders(game, stock, 0, 30_000_000);

    expect(whale.preferredSectors).not.toContain(stock.sector);
    expect(orders.some((order) => order.side === "sell" && order.intention === "attack")).toBe(true);
  });

  it("adds shrimp height-fear supply after a smooth rich climb", () => {
    const flat = createInitialGame("flat-shrimp-height-test");
    const extended = createInitialGame("extended-shrimp-height-test");

    for (const game of [flat, extended]) {
      advanceToIntraday(game);
      const stock = game.stocks.RED_RIVER_LITHIUM;
      stock.price = 18.4;
      stock.previousClose = 18.4;
      stock.open = 18.4;
      stock.avgHolderCost = 16.2;
      stock.retail.greed = 72;
      stock.retail.fear = 10;
      stock.retail.boardFaith = 58;
      stock.heat = 34;
      updateValuationFromPrice(stock);
    }

    flat.stocks.RED_RIVER_LITHIUM.dailyCandles = [
      { day: -5, open: 18.2, high: 18.5, low: 18, close: 18.4, volume: 1, turnover: 1, boardState: "loose" },
      { day: -4, open: 18.4, high: 18.6, low: 18.1, close: 18.35, volume: 1, turnover: 1, boardState: "loose" },
      { day: -3, open: 18.35, high: 18.55, low: 18.1, close: 18.42, volume: 1, turnover: 1, boardState: "loose" },
      { day: -2, open: 18.42, high: 18.6, low: 18.2, close: 18.38, volume: 1, turnover: 1, boardState: "loose" },
      { day: -1, open: 18.38, high: 18.5, low: 18.2, close: 18.4, volume: 1, turnover: 1, boardState: "loose" },
      { day: 1, open: 18.4, high: 18.4, low: 18.4, close: 18.4, volume: 1, turnover: 1, boardState: "loose" }
    ];
    extended.stocks.RED_RIVER_LITHIUM.dailyCandles = [
      { day: -5, open: 12.9, high: 13.3, low: 12.8, close: 13.2, volume: 1, turnover: 1, boardState: "loose" },
      { day: -4, open: 13.2, high: 14.1, low: 13.1, close: 14, volume: 1, turnover: 1, boardState: "loose" },
      { day: -3, open: 14, high: 15.2, low: 13.9, close: 15.1, volume: 1, turnover: 1, boardState: "loose" },
      { day: -2, open: 15.1, high: 16.7, low: 15, close: 16.6, volume: 1, turnover: 1, boardState: "attackingLimitUp" },
      { day: -1, open: 16.6, high: 18.5, low: 16.5, close: 18.4, volume: 1, turnover: 1, boardState: "loose" },
      { day: 1, open: 18.4, high: 18.4, low: 18.4, close: 18.4, volume: 1, turnover: 1, boardState: "loose" }
    ];

    const flatValuation = calculateFundamentalPressure(flat, flat.stocks.RED_RIVER_LITHIUM).valuation;
    const extendedValuation = calculateFundamentalPressure(extended, extended.stocks.RED_RIVER_LITHIUM).valuation;
    const flatPressure = calculateShrimpCollectivePressure(flat, flat.stocks.RED_RIVER_LITHIUM, 0, flatValuation);
    const extendedPressure = calculateShrimpCollectivePressure(extended, extended.stocks.RED_RIVER_LITHIUM, 0, extendedValuation);

    expect(extendedPressure.sellPressure).toBeGreaterThan(flatPressure.sellPressure * 1.35);
    expect(extendedPressure.sellPressure).toBeGreaterThan(extendedPressure.buyPressure);
  });

  it("digests fundamentals periodically instead of keeping them frozen", () => {
    const game = createInitialGame("fundamental-digest-test");
    const initialGrowth = Object.fromEntries(Object.values(game.stocks).map((stock) => [stock.id, stock.profitGrowth]));
    const initialEps = Object.fromEntries(Object.values(game.stocks).map((stock) => [stock.id, stock.earningsPerShare]));

    for (let i = 0; i < GAME_CONFIG.ticksPerDay * 6 + 40 && game.phase !== "ended"; i += 1) {
      updateTick(game);
      if (game.phase === "preMarket" && game.tick === 0 && game.day >= 6) break;
    }

    const changed = Object.values(game.stocks).some(
      (stock) => stock.profitGrowth !== initialGrowth[stock.id] || stock.earningsPerShare !== initialEps[stock.id]
    );

    expect(changed).toBe(true);
    expect(game.eventLog.some((event) => event.type === "fundamentalDigest")).toBe(true);
  });

  it("does not let Red River Lithium print a 20-day up-only staircase", () => {
    const game = createInitialGame("red-river-path");
    const returns: number[] = [];
    let lastClose = game.stocks.RED_RIVER_LITHIUM.price;

    while (game.phase !== "ended" && returns.length < 20) {
      updateTick(game);
      if (game.phase === "preMarket" && game.tick === 0) {
        const close = game.stocks.RED_RIVER_LITHIUM.previousClose;
        returns.push((close / lastClose - 1) * 100);
        lastClose = close;
      }
    }

    expect(returns).toHaveLength(20);
    expect(returns.some((value) => value < -0.1)).toBe(true);
    expect(new Set(returns.map((value) => value.toFixed(1))).size).toBeGreaterThan(6);
  });

  it("is deterministic for the same seed and action path", () => {
    const a = createInitialGame("deterministic-kernel");
    const b = createInitialGame("deterministic-kernel");

    updateTick(a);
    updateTick(b);
    updateTick(a);
    updateTick(b);

    const actions = [{ type: "marketBuy" as const, stockId: "SKY_SHIELD" as const, amountCash: 8_000_000 }];
    updateTick(a, actions);
    updateTick(b, actions);

    for (let i = 0; i < 8; i += 1) {
      updateTick(a);
      updateTick(b);
    }

    expect(a.stocks.SKY_SHIELD.price).toBe(b.stocks.SKY_SHIELD.price);
    expect(a.player.netWorth).toBe(b.player.netWorth);
    expect(a.eventLog.map((event) => event.message)).toEqual(b.eventLog.map((event) => event.message));
  });

  it("returns compact tick summaries by default while retaining full detail on request", () => {
    const compact = createInitialGame("compact-tick-result-test");
    const detailed = createInitialGame("compact-tick-result-test");
    advanceToIntraday(compact);
    advanceToIntraday(detailed);

    const compactResult = updateTickSummary(compact, [{ type: "marketBuy", stockId: "DRAGON_SOFT", amountCash: 20_000_000 }]);
    const detailedResult = updateTick(detailed, [{ type: "marketBuy", stockId: "DRAGON_SOFT", amountCash: 20_000_000 }]);
    const compactTrace = findStockTrace(compactResult, "DRAGON_SOFT");
    const detailedTrace = findStockTrace(detailedResult, "DRAGON_SOFT");

    expect(compactResult.playerFills.length).toBeGreaterThan(0);
    expect(compactTrace.playerFills).toHaveLength(0);
    expect(compactTrace.whaleTrades).toHaveLength(0);
    expect(compactTrace.heatCauses).toHaveLength(0);
    expect(compactResult.detail).toBeUndefined();

    expect(detailedTrace.playerFills.length).toBeGreaterThan(0);
    expect(detailedResult.detail?.stocks.length).toBe(detailedResult.stocks.length);
  });

  it("caps the retained game event log", () => {
    const game = createInitialGame("event-log-cap-test");

    for (let index = 0; index < 2_050; index += 1) {
      game.eventLog.push({
        day: 1,
        tick: index,
        type: "synthetic",
        message: `Synthetic event ${index}`
      });
    }

    updateTickSummary(game);

    expect(game.eventLog).toHaveLength(2_000);
    expect(game.eventLog[0]?.message).toBe("Synthetic event 51");
  });
});

function countTapeTurns(path: number[]): { turns: number; nonzeroTicks: number; maxSameDirectionRun: number } {
  let turns = 0;
  let nonzeroTicks = 0;
  let maxSameDirectionRun = 0;
  let run = 0;
  let previousSign = 0;

  for (let index = 1; index < path.length; index += 1) {
    const deltaTicks = Math.round((path[index] - path[index - 1]) * 100);
    const sign = deltaTicks > 0 ? 1 : deltaTicks < 0 ? -1 : 0;
    if (sign === 0) continue;

    nonzeroTicks += 1;
    if (previousSign !== 0 && sign !== previousSign) turns += 1;
    run = sign === previousSign ? run + 1 : 1;
    maxSameDirectionRun = Math.max(maxSameDirectionRun, run);
    previousSign = sign;
  }

  return { turns, nonzeroTicks, maxSameDirectionRun };
}

function measureTapeDeltas(path: number[]): { maxAbsDelta: number; distinctAbsMoves: number; maxSameNonzeroMagnitudeRun: number } {
  let maxAbsDelta = 0;
  let maxSameNonzeroMagnitudeRun = 0;
  let sameNonzeroMagnitudeRun = 0;
  let previousMagnitude = -1;
  const distinctAbsMoves = new Set<number>();

  for (let index = 1; index < path.length; index += 1) {
    const magnitude = Math.abs(Math.round((path[index] - path[index - 1]) * 100));
    if (magnitude > 0) distinctAbsMoves.add(magnitude);
    maxAbsDelta = Math.max(maxAbsDelta, magnitude);

    if (magnitude === 0) {
      sameNonzeroMagnitudeRun = 0;
      previousMagnitude = -1;
    } else if (magnitude === previousMagnitude) {
      sameNonzeroMagnitudeRun += 1;
    } else {
      sameNonzeroMagnitudeRun = 1;
      previousMagnitude = magnitude;
    }
    maxSameNonzeroMagnitudeRun = Math.max(maxSameNonzeroMagnitudeRun, sameNonzeroMagnitudeRun);
  }

  return { maxAbsDelta, distinctAbsMoves: distinctAbsMoves.size, maxSameNonzeroMagnitudeRun };
}
