import { GAME_CONFIG } from "../game/config";
import { syncDailyCandle } from "../game/charting";
import type { GameEvent, GameState, HeatCauseTrace, PlayerAction, Pressure, Stock, StockTickTrace, TickOptions, TickResult } from "../game/types";
import { calculateRestingBuyVisibility, processPlayerOrdersForStock } from "../player/actions";
import { recalculatePlayerNetWorth } from "../player/portfolio";
import { executeAmbientTape } from "./ambientTape";
import { updateBoardState } from "./boardEngine";
import { calculateFundamentalPressure } from "./fundamentalEngine";
import { calculateInstitutionPressure } from "./institutionEngine";
import { updateMarketBreadth } from "./marketBreadthEngine";
import { createMarketDepth } from "./marketDepth";
import { applyNewsActorEffects, calculateNewsPressure } from "./newsEngine";
import { runOpeningAuction } from "./openingAuctionEngine";
import { applyResidualPriceImpact, createPressure, updateLiquidity, updateStockDerivedMetrics } from "./priceEngine";
import { calculateQuantPressure } from "./quantEngine";
import { applyBoardStateTransitionEffects, calculateRetailPressure, updateRetailProfile } from "./retailEngine";
import { settleDay } from "./settlement";
import { applyShrimpCollectiveEffects, calculateShrimpCollectivePressure } from "./shrimpCollectiveEngine";
import { MARKET_BEHAVIOR_CONFIG } from "./marketBehaviorConfig";
import { markAllWhalesToMarket } from "./whaleAccounting";
import { createWhaleOrders, executeWhaleOrders } from "./whaleEngine";

const tickConfig = MARKET_BEHAVIOR_CONFIG.tick;

export function advancePhase(game: GameState): string | undefined {
  if (game.phase === "preMarket") {
    game.phase = "openingAuction";
    appendEvent(game, "phase", "Opening auction begins.");
    return "openingAuction";
  }

  if (game.phase === "openingAuction") {
    for (let auctionTick = 1; auctionTick < MARKET_BEHAVIOR_CONFIG.openingAuction.phaseTicks; auctionTick += 1) {
      game.tick = auctionTick;
      appendEvent(game, "phase", "Opening auction indicative book updates.");
    }
    runOpeningAuction(game);
    game.tick = 0;
    game.phase = "intraday";
    appendEvent(game, "phase", "Intraday trading begins.");
    return "intraday";
  }

  if (game.phase === "intraday") {
    game.phase = "closingAuction";
    appendEvent(game, "phase", "Closing auction begins.");
    return "closingAuction";
  }

  if (game.phase === "closingAuction") {
    game.phase = "settlement";
    appendEvent(game, "phase", "Settlement begins.");
    settleDay(game);
    return game.phase;
  }

  return undefined;
}

export function updateTick(game: GameState, playerActions: PlayerAction[] = [], options: TickOptions = {}): TickResult {
  const eventStart = game.eventLog.length;
  const resultDay = game.day;
  const resultTick = game.tick;
  let stocks: StockTickTrace[] = [];
  let phaseChanged: string | undefined;

  if (game.phase === "ended") {
    return buildTickResult(game, resultDay, resultTick, eventStart, stocks, undefined, options);
  }

  if (game.phase === "preMarket" || game.phase === "openingAuction") {
    phaseChanged = advancePhase(game);
    return buildTickResult(game, resultDay, resultTick, eventStart, stocks, phaseChanged, options);
  }

  if (game.phase === "closingAuction") {
    stocks = processMarketTick(game, playerActions);
    phaseChanged = advancePhase(game);
    return buildTickResult(game, resultDay, resultTick, eventStart, stocks, phaseChanged, options);
  }

  if (game.phase === "intraday") {
    stocks = processMarketTick(game, playerActions);
    game.tick += 1;

    if (game.tick >= GAME_CONFIG.ticksPerDay) {
      phaseChanged = advancePhase(game);
    }
  }

  return buildTickResult(game, resultDay, resultTick, eventStart, stocks, phaseChanged, options);
}

export function runTicks(game: GameState, count: number): TickResult[] {
  const results: TickResult[] = [];
  for (let i = 0; i < count && game.phase !== "ended"; i += 1) {
    results.push(updateTick(game));
  }
  return results;
}

function processMarketTick(game: GameState, playerActions: PlayerAction[]): StockTickTrace[] {
  const traces: StockTickTrace[] = [];

  for (const stock of Object.values(game.stocks)) {
    if (stock.halted) continue;

    const priceBefore = stock.price;
    const previousState = stock.boardState;
    const heatBefore = stock.heat;
    const sentimentBefore = stock.sentiment;
    const attentionBefore = stock.attention;

    const news = calculateNewsPressure(game, stock);
    applyNewsActorEffects(stock, news);
    updateRetailProfile(stock);
    updateLiquidity(game, stock);

    const retail = calculateRetailPressure(stock, news.impact);
    const fundamental = calculateFundamentalPressure(game, stock);
    const collective = calculateShrimpCollectivePressure(game, stock, news.impact, fundamental.valuation);
    applyShrimpCollectiveEffects(stock, collective);
    const initialQuant = calculateQuantPressure(game, stock, news.impact, getRestingVisibility(game, stock));
    const institution = calculateInstitutionPressure(game, stock, fundamental.valuation);
    const basePressure = createPressure(game, stock, {
      retailBuyPressure: retail.buyPressure,
      retailSellPressure: retail.sellPressure,
      quantBuyPressure: initialQuant.buyPressure,
      quantSellPressure: initialQuant.sellPressure,
      institutionBuyPressure: institution.buyPressure,
      institutionSellPressure: institution.sellPressure,
      collectiveBuyPressure: collective.buyPressure,
      collectiveSellPressure: collective.sellPressure,
      fundamentalBuyPressure: fundamental.buyPressure,
      fundamentalSellPressure: fundamental.sellPressure,
      newsBuyPressure: news.buyPressure,
      newsSellPressure: news.sellPressure
    });
    const depth = createMarketDepth(stock, basePressure);
    const player = processPlayerOrdersForStock(game, stock, depth, playerActions);
    const quant = calculateQuantPressure(game, stock, news.impact, player.visibility);
    const postPlayerDepth = createMarketDepth(stock, {
      buyPressure: basePressure.buyPressure + player.buyPressure,
      sellPressure: basePressure.sellPressure + player.sellPressure
    });
    const whaleOrders = createWhaleOrders(game, stock, player.visibility, postPlayerDepth.effectiveDepth);
    const whaleTrades = executeWhaleOrders(game, postPlayerDepth, whaleOrders);
    const playerFilledBuyPressure = player.fills
      .filter((fill) => fill.side === "buy")
      .reduce((total, fill) => total + fill.filledNotional, 0);
    const playerFilledSellPressure = player.fills
      .filter((fill) => fill.side === "sell")
      .reduce((total, fill) => total + fill.filledNotional, 0);
    const playerResidualBuyPressure = Math.max(0, player.buyPressure - playerFilledBuyPressure);
    const playerResidualSellPressure = Math.max(0, player.sellPressure - playerFilledSellPressure);
    const playerExecutedBuyFootprint = playerFilledBuyPressure * tickConfig.participantFootprint.playerExecutedBuy;
    const playerExecutedSellFootprint = playerFilledSellPressure * tickConfig.participantFootprint.playerExecutedSell;
    const whaleBuyPressure = whaleTrades
      .filter((fill) => fill.side === "buy")
      .reduce((total, fill) => total + fill.filledNotional * tickConfig.participantFootprint.whaleExecuted, 0);
    const whaleSellPressure = whaleTrades
      .filter((fill) => fill.side === "sell")
      .reduce((total, fill) => total + fill.filledNotional * tickConfig.participantFootprint.whaleExecuted, 0);

    const pressure = createPressure(game, stock, {
      playerBuyPressure: playerResidualBuyPressure + playerExecutedBuyFootprint,
      playerSellPressure: playerResidualSellPressure + playerExecutedSellFootprint,
      retailBuyPressure: retail.buyPressure,
      retailSellPressure: retail.sellPressure,
      whaleBuyPressure,
      whaleSellPressure,
      quantBuyPressure: quant.buyPressure,
      quantSellPressure: quant.sellPressure,
      institutionBuyPressure: institution.buyPressure,
      institutionSellPressure: institution.sellPressure,
      collectiveBuyPressure: collective.buyPressure,
      collectiveSellPressure: collective.sellPressure,
      fundamentalBuyPressure: fundamental.buyPressure,
      fundamentalSellPressure: fundamental.sellPressure,
      newsBuyPressure: news.buyPressure,
      newsSellPressure: news.sellPressure
    });

    const ambientTape = executeAmbientTape(game, stock, pressure);
    applyResidualPriceImpact(game, stock, pressure, postPlayerDepth.effectiveDepth, {
      ambientTape,
      playerFills: player.fills,
      whaleTrades
    });
    updateBoardState(stock, pressure);
    applyBoardStateTransitionEffects(stock, previousState);
    updateStockDerivedMetrics(stock);

    stock.chart.push({
      day: game.day,
      tick: game.tick,
      price: stock.price,
      boardState: stock.boardState
    });
    syncDailyCandle(stock, game.day);

    appendBoardEvents(game, stock, previousState);
    const heatCauses = buildHeatCauses({
      stock,
      previousState,
      priceBefore,
      heatBefore,
      sentimentBefore,
      attentionBefore,
      pressure,
      collective,
      playerFilledBuyPressure,
      playerFilledSellPressure,
      whaleTrades,
      quant,
      newsImpact: news.impact,
      fundamentalBuyPressure: fundamental.buyPressure,
      fundamentalSellPressure: fundamental.sellPressure
    });
    traces.push(buildStockTrace(stock, priceBefore, pressure, postPlayerDepth, player.fills, player.restingOrders, whaleTrades, heatCauses));
  }

  markAllWhalesToMarket(game);
  recalculatePlayerNetWorth(game);
  updateMarketBreadth(game);
  return traces;
}

function buildStockTrace(
  stock: Stock,
  priceBefore: number,
  pressure: Pressure,
  depth: ReturnType<typeof createMarketDepth>,
  playerFills: StockTickTrace["playerFills"],
  restingOrders: StockTickTrace["restingOrders"],
  whaleTrades: StockTickTrace["whaleTrades"],
  heatCauses: StockTickTrace["heatCauses"]
): StockTickTrace {
  return {
    stockId: stock.id,
    name: stock.name,
    marketCapClass: depth.marketCapClass,
    priceBefore,
    priceAfter: stock.price,
    changePct: ((stock.price - stock.previousClose) / stock.previousClose) * 100,
    boardState: stock.boardState,
    buyQueue: stock.buyQueue,
    sellQueue: stock.sellQueue,
    boardQueueLedger: {
      buy: { ...stock.boardQueueLedger.buy },
      sell: { ...stock.boardQueueLedger.sell }
    },
    boardStrength: stock.boardStrength,
    currentLiquidity: stock.currentLiquidity,
    effectiveDepth: depth.effectiveDepth,
    bidNotional: depth.bidNotional,
    askNotional: depth.askNotional,
    pressure,
    playerFills,
    restingOrders,
    whaleTrades,
    heatCauses
  };
}

function buildHeatCauses(args: {
  stock: Stock;
  previousState: string;
  priceBefore: number;
  heatBefore: number;
  sentimentBefore: number;
  attentionBefore: number;
  pressure: Pressure;
  collective: ReturnType<typeof calculateShrimpCollectivePressure>;
  playerFilledBuyPressure: number;
  playerFilledSellPressure: number;
  whaleTrades: StockTickTrace["whaleTrades"];
  quant: ReturnType<typeof calculateQuantPressure>;
  newsImpact: number;
  fundamentalBuyPressure: number;
  fundamentalSellPressure: number;
}): HeatCauseTrace[] {
  const causes: HeatCauseTrace[] = [];

  if (args.playerFilledBuyPressure > 0 || args.playerFilledSellPressure > 0) {
    causes.push({
      source: "player",
      heatDelta:
        (Math.max(args.playerFilledBuyPressure, args.playerFilledSellPressure) / Math.max(1, args.stock.currentLiquidity)) *
        tickConfig.heatCauses.playerLiquidityScale,
      buyPressure: args.playerFilledBuyPressure,
      sellPressure: args.playerFilledSellPressure,
      note: args.playerFilledSellPressure > args.playerFilledBuyPressure ? "visible player sell left a footprint" : "visible player buy left a footprint"
    });
  }

  if (args.collective.buyPressure > 0 || args.collective.sellPressure > 0 || args.collective.heatDelta !== 0) {
    causes.push({
      source: "collective",
      heatDelta: args.collective.heatDelta,
      sentimentDelta: args.collective.sentimentDelta,
      attentionDelta: args.collective.attentionDelta,
      buyPressure: args.collective.buyPressure,
      sellPressure: args.collective.sellPressure,
      note: args.collective.narrative
    });
  }

  const whaleBuy = args.whaleTrades.filter((fill) => fill.side === "buy").reduce((total, fill) => total + fill.filledNotional, 0);
  const whaleSell = args.whaleTrades.filter((fill) => fill.side === "sell").reduce((total, fill) => total + fill.filledNotional, 0);
  if (whaleBuy > 0 || whaleSell > 0) {
    causes.push({
      source: "whale",
      heatDelta: (Math.max(whaleBuy, whaleSell) / Math.max(1, args.stock.currentLiquidity)) * tickConfig.heatCauses.whaleLiquidityScale,
      buyPressure: whaleBuy,
      sellPressure: whaleSell,
      note: whaleSell > whaleBuy ? "large traders supplied stock" : "large traders absorbed stock"
    });
  }

  if (args.quant.buyPressure > 0 || args.quant.sellPressure > 0) {
    causes.push({
      source: "quant",
      heatDelta:
        (Math.max(args.quant.buyPressure, args.quant.sellPressure) / Math.max(1, args.stock.currentLiquidity)) *
        tickConfig.heatCauses.quantLiquidityScale,
      buyPressure: args.quant.buyPressure,
      sellPressure: args.quant.sellPressure,
      note: args.quant.sellPressure > args.quant.buyPressure ? "quant signal leaned short" : "quant signal leaned long"
    });
  }

  if (args.fundamentalBuyPressure > 0 || args.fundamentalSellPressure > 0) {
    causes.push({
      source: "fundamental",
      heatDelta: -Math.min(
        tickConfig.heatCauses.fundamentalHeatCap,
        (Math.max(args.fundamentalBuyPressure, args.fundamentalSellPressure) / Math.max(1, args.stock.currentLiquidity)) *
          tickConfig.heatCauses.fundamentalLiquidityScale
      ),
      buyPressure: args.fundamentalBuyPressure,
      sellPressure: args.fundamentalSellPressure,
      note: args.fundamentalSellPressure > args.fundamentalBuyPressure ? "valuation created supply" : "valuation attracted dip buyers"
    });
  }

  if (Math.abs(args.newsImpact) > 0) {
    causes.push({
      source: "news",
      heatDelta: Math.min(tickConfig.heatCauses.newsHeatCap, Math.abs(args.newsImpact) / tickConfig.heatCauses.newsImpactHeatScale),
      sentimentDelta: args.newsImpact / tickConfig.heatCauses.newsSentimentScale,
      note: args.newsImpact > 0 ? "active news supported risk appetite" : "active news fed risk aversion"
    });
  }

  if (args.previousState !== args.stock.boardState) {
    causes.push({
      source: "board",
      heatDelta:
        args.stock.boardState === "sealedLimitUp" || args.stock.boardState === "limitDown"
          ? tickConfig.heatCauses.boardHardStateHeat
          : tickConfig.heatCauses.boardSoftStateHeat,
      note: `board state changed from ${args.previousState} to ${args.stock.boardState}`
    });
  }

  const priceMovePct = ((args.stock.price - args.priceBefore) / Math.max(0.01, args.priceBefore)) * 100;
  if (Math.abs(priceMovePct) > tickConfig.heatCauses.priceMovePctThreshold) {
    causes.push({
      source: "price",
      heatDelta: Math.min(tickConfig.heatCauses.priceMoveHeatCap, Math.abs(priceMovePct) * tickConfig.heatCauses.priceMoveHeatPerPct),
      sentimentDelta: priceMovePct > 0 ? tickConfig.heatCauses.priceMoveSentimentDelta : -tickConfig.heatCauses.priceMoveSentimentDelta,
      note: `fast price move ${priceMovePct.toFixed(1)}% changed attention`
    });
  }

  const netHeatDelta = args.stock.heat - args.heatBefore;
  if (Math.abs(netHeatDelta) > tickConfig.heatCauses.netHeatTraceThreshold) {
    causes.push({
      source: "price",
      heatDelta: netHeatDelta,
      sentimentDelta: args.stock.sentiment - args.sentimentBefore,
      attentionDelta: args.stock.attention - args.attentionBefore,
      note: "net tick heat/sentiment/attention change"
    });
  }

  return causes;
}

function getRestingVisibility(game: GameState, stock: Stock): number {
  return game.player.activeOrders
    .filter((order) => order.owner === "player" && order.side === "buy" && order.stockId === stock.id)
    .reduce((visibility, order) => Math.max(visibility, calculateRestingBuyVisibility(stock, order.amountCash ?? 0, order.limitPrice)), 0);
}

function appendBoardEvents(game: GameState, stock: Stock, previousState: string): void {
  if (previousState === stock.boardState) return;

  const messages: Record<string, string> = {
    attackingLimitUp: `${stock.name} is attacking limit-up at ${stock.price.toFixed(2)}.`,
    sealedLimitUp: `${stock.name} sealed limit-up at ${stock.price.toFixed(2)}.`,
    weakSeal: `${stock.name} board weakened at ${stock.price.toFixed(2)}.`,
    brokenBoard: `${stock.name} board broke at ${stock.price.toFixed(2)}.`,
    panic: `Retail panic is spreading in ${stock.name} at ${stock.price.toFixed(2)}.`,
    limitDown: `${stock.name} locked limit-down at ${stock.price.toFixed(2)}.`,
    loose: `${stock.name} returned to loose trading at ${stock.price.toFixed(2)}.`
  };

  appendEvent(game, "boardState", messages[stock.boardState] ?? `${stock.name} changed board state.`, stock.id);
}

function appendEvent(game: GameState, type: string, message: string, stockId?: Stock["id"]): void {
  game.eventLog.push({
    day: game.day,
    tick: game.tick,
    type,
    message,
    stockId
  });
}

function buildTickResult(
  game: GameState,
  day: number,
  tick: number,
  eventStart: number,
  stocks: StockTickTrace[],
  phaseChanged?: string,
  options: TickOptions = {}
): TickResult {
  const events = game.eventLog.slice(eventStart);
  const fullDetail = options.detail === "full";
  const playerFills = stocks.flatMap((stock) => stock.playerFills);
  const whaleTrades = stocks.flatMap((stock) => stock.whaleTrades);
  trimEventLog(game);

  return {
    day,
    tick,
    phase: game.phase,
    phaseChanged,
    stocks: fullDetail ? stocks : stocks.map(compactStockTrace),
    playerFills,
    whaleTrades,
    events,
    detail: fullDetail ? { stocks } : undefined
  };
}

function compactStockTrace(stock: StockTickTrace): StockTickTrace {
  return {
    ...stock,
    playerFills: [],
    restingOrders: [],
    whaleTrades: [],
    heatCauses: []
  };
}

function trimEventLog(game: GameState): void {
  if (game.eventLog.length <= MARKET_BEHAVIOR_CONFIG.eventLog.maxEntries) return;
  game.eventLog = game.eventLog.slice(-MARKET_BEHAVIOR_CONFIG.eventLog.maxEntries);
}
