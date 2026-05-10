import { clamp, GAME_CONFIG, roundMoney } from "../game/config";
import { createRng } from "../game/rng";
import type { GameState, ShrimpCohort, ShrimpStrategy, Stock } from "../game/types";
import type { ValuationSnapshot } from "../game/fundamentals";
import { getLimitRatio, getLowerLimit, getUpperLimit } from "./boardEngine";
import { getMarketMemory } from "./marketMemory";

export type ShrimpCollectivePressure = {
  buyPressure: number;
  sellPressure: number;
  heatDelta: number;
  sentimentDelta: number;
  attentionDelta: number;
  burstCount: number;
  dominantStrategy: ShrimpStrategy;
  narrative: string;
};

type LegacyPressure = Pick<ShrimpCollectivePressure, "buyPressure" | "sellPressure" | "heatDelta" | "sentimentDelta" | "attentionDelta"> & {
  notes: string[];
};

type CohortFlow = {
  buyPressure: number;
  sellPressure: number;
  heatDelta: number;
  sentimentDelta: number;
  attentionDelta: number;
  burstCount: number;
  dominantStrategy: ShrimpStrategy;
  dominantNotional: number;
  notes: string[];
};

type MarketContext = {
  tick: number;
  dayChangePct: number;
  openChangePct: number;
  lastTickMovePct: number;
  previousBoardWasHot: boolean;
  failedBoardFollowThrough: boolean;
  fightBack: boolean;
  noBidSlide: boolean;
  storyScore: number;
  washoutScore: number;
  fearScore: number;
  boardChaseScore: number;
  limitProgressUp: number;
  limitProgressDown: number;
  upperGapPct: number;
  lowerGapPct: number;
  limitUpMagnet: boolean;
  panicCascade: boolean;
  supportFailure: boolean;
  resistanceScore: number;
  memoryReturn5d: number;
  upStreak: number;
  downStreak: number;
  boardBreaks5d: number;
  limitDownDays5d: number;
};

const BASELINE_TICK_SECONDS = 5;

export function calculateShrimpCollectivePressure(
  game: GameState,
  stock: Stock,
  newsImpact: number,
  valuation: ValuationSnapshot
): ShrimpCollectivePressure {
  const rng = createRng(`${game.rngSeed}:shrimp:${game.day}:${game.tick}:${stock.id}`);
  const context = buildContext(game, stock, newsImpact, valuation);
  const legacy = calculateLegacyCrowdPressure(stock, rng, valuation, context);
  const cohortFlow = calculateCohortFlow(game, stock, rng, newsImpact, valuation, context);

  const buyPressure = clamp(
    legacy.buyPressure * 0.42 + cohortFlow.buyPressure,
    0,
    stock.currentLiquidity * getShrimpPressureCap(stock, "buy", cohortFlow.dominantStrategy)
  );
  const sellPressure = clamp(
    legacy.sellPressure * 0.42 + cohortFlow.sellPressure,
    0,
    stock.currentLiquidity * getShrimpPressureCap(stock, "sell", cohortFlow.dominantStrategy)
  );
  const notes = [...cohortFlow.notes, ...legacy.notes].slice(0, 3);

  return {
    buyPressure,
    sellPressure,
    heatDelta: clamp(legacy.heatDelta * 0.55 + cohortFlow.heatDelta, 0, 1.6),
    sentimentDelta: clamp(legacy.sentimentDelta * 0.55 + cohortFlow.sentimentDelta, -1.1, 1.1),
    attentionDelta: clamp(legacy.attentionDelta * 0.55 + cohortFlow.attentionDelta, 0, 1.6),
    burstCount: cohortFlow.burstCount,
    dominantStrategy: cohortFlow.dominantStrategy,
    narrative: notes.length > 0 ? notes.join("; ") : "retail cohorts are trading mixed small orders"
  };
}

export function applyShrimpCollectiveEffects(stock: Stock, pressure: ShrimpCollectivePressure): void {
  const timeScale = GAME_CONFIG.tickDurationSeconds / BASELINE_TICK_SECONDS;
  stock.heat = clamp(stock.heat + pressure.heatDelta * timeScale, 0, 100);
  stock.sentiment = clamp(stock.sentiment + pressure.sentimentDelta * timeScale, 0, 100);
  stock.attention = clamp(stock.attention + pressure.attentionDelta * timeScale, 0, 100);
}

function buildContext(game: GameState, stock: Stock, newsImpact: number, valuation: ValuationSnapshot): MarketContext {
  const dayChangePct = ((stock.price - stock.previousClose) / stock.previousClose) * 100;
  const openChangePct = ((stock.price - stock.open) / Math.max(0.01, stock.open)) * 100;
  const previousPrint = stock.chart.at(-2)?.price ?? stock.open;
  const lastTickMovePct = ((stock.price - previousPrint) / Math.max(0.01, previousPrint)) * 100;
  const memory = getMarketMemory(game, stock);
  const upperLimit = getUpperLimit(stock);
  const lowerLimit = getLowerLimit(stock);
  const limitPct = getLimitRatio(stock) * 100;
  const limitProgressUp = clamp(dayChangePct / Math.max(1, limitPct), 0, 1);
  const limitProgressDown = clamp(-dayChangePct / Math.max(1, limitPct), 0, 1);
  const upperGapPct = ((upperLimit - stock.price) / Math.max(0.01, stock.previousClose)) * 100;
  const lowerGapPct = ((stock.price - lowerLimit) / Math.max(0.01, stock.previousClose)) * 100;
  const sector = game.sectors[stock.sector];
  const previousDay = stock.dailyCandles.find((candle) => candle.day === game.day - 1);
  const previousBoardWasHot =
    previousDay?.boardState === "sealedLimitUp" ||
    previousDay?.boardState === "weakSeal" ||
    previousDay?.boardState === "attackingLimitUp";
  const fightBack =
    stock.microstructure.flowMemory > 5 ||
    stock.buyQueue > stock.currentLiquidity * 0.08 ||
    (lastTickMovePct > 0.05 && dayChangePct < -0.8);
  const noBidSlide =
    dayChangePct < -1.2 &&
    stock.microstructure.flowMemory < -5 &&
    stock.buyQueue < stock.currentLiquidity * 0.025 &&
    stock.microstructure.lastPrintSign <= 0;
  const storyScore =
    stock.attention * 0.22 +
    sector.attention * 0.18 +
    stock.retail.gamblers * 0.12 +
    Math.max(0, sector.momentum) * 0.72 +
    Math.max(0, newsImpact) * 0.26 +
    Math.max(0, stock.momentum) * 0.12;
  const washoutScore =
    Math.max(0, -dayChangePct - 2.4) * 6.2 +
    Math.max(0, -valuation.valuationGap) * 42 +
    stock.retail.dipBuyers * 0.3 +
    stock.retail.bagholders * 0.12 -
    Math.max(0, 42 - stock.financialHealth) * 0.34;
  const fearScore =
    stock.retail.fear * 0.32 +
    stock.retail.panicSellers * 0.28 +
    Math.max(0, -stock.momentum - 20) * 0.24 +
    Math.max(0, -dayChangePct - 4.2) * 3.4 +
    Math.max(0, -memory.return3d - 5) * 1.35 +
    Math.max(0, memory.downStreak - 1) * 3.8 +
    memory.boardBreaks5d * 3.4 +
    (memory.lastTickMovePct < -0.45 ? 5 : 0) +
    Math.max(0, -newsImpact) * 0.42;
  const boardChaseScore =
    storyScore +
    stock.retail.boardFaith * 0.22 +
    stock.retail.greed * 0.14 +
    stock.heat * 0.08 +
    (previousBoardWasHot ? 18 : 0) +
    (stock.boardState === "attackingLimitUp" || stock.boardState === "weakSeal" ? 14 : 0) +
    (stock.boardState === "sealedLimitUp" ? 12 : 0);
  const supportFailure =
    dayChangePct < -2.1 &&
    !fightBack &&
    (lastTickMovePct < -0.03 || memory.lastTickMovePct < -0.35 || stock.microstructure.flowMemory < -10) &&
    stock.buyQueue < stock.currentLiquidity * 0.045;
  const panicCascade =
    (stock.boardState === "panic" || stock.boardState === "limitDown" || (limitProgressDown > 0.38 && fearScore > 48)) &&
    (noBidSlide || supportFailure || lastTickMovePct < -0.055);
  const limitUpMagnet =
    stock.boardState !== "limitDown" &&
    boardChaseScore > 61 &&
    limitProgressUp > 0.56 &&
    upperGapPct < limitPct * 0.32 &&
    !supportFailure;
  const resistanceScore =
    stock.costDistribution.deepProfit * 0.28 +
    stock.costDistribution.profit * 0.18 +
    Math.max(0, valuation.valuationGap - 0.32) * 42 +
    Math.max(0, dayChangePct - 4) * 3.2 +
    Math.max(0, memory.return5d - 12) * 1.2 +
    Math.max(0, memory.upStreak - 3) * 4.8 +
    stock.heat * 0.12;

  return {
    tick: game.tick,
    dayChangePct,
    openChangePct,
    lastTickMovePct,
    previousBoardWasHot,
    failedBoardFollowThrough: previousBoardWasHot && (dayChangePct < -0.9 || openChangePct < -0.65),
    fightBack,
    noBidSlide,
    storyScore,
    washoutScore,
    fearScore,
    boardChaseScore,
    limitProgressUp,
    limitProgressDown,
    upperGapPct,
    lowerGapPct,
    limitUpMagnet,
    panicCascade,
    supportFailure,
    resistanceScore,
    memoryReturn5d: memory.return5d,
    upStreak: memory.upStreak,
    downStreak: memory.downStreak,
    boardBreaks5d: memory.boardBreaks5d,
    limitDownDays5d: memory.limitDownDays5d
  };
}

function calculateCohortFlow(
  game: GameState,
  stock: Stock,
  rng: ReturnType<typeof createRng>,
  newsImpact: number,
  valuation: ValuationSnapshot,
  context: MarketContext
): CohortFlow {
  let buyPressure = 0;
  let sellPressure = 0;
  let heatDelta = 0;
  let sentimentDelta = 0;
  let attentionDelta = 0;
  let burstCount = 0;
  let dominantStrategy: ShrimpStrategy = "noiseTrader";
  let dominantNotional = 0;
  const notes: string[] = [];

  for (const cohort of stock.shrimpCohorts) {
    updateCohortComposition(cohort, stock, rng, valuation, context);
    const intent = calculateCohortIntent(cohort, stock, rng, newsImpact, valuation, context);
    const burst = quantizeSmallOrderBurst(cohort, stock, rng, intent.buyIntent, intent.sellIntent, intent.urgency);

    buyPressure += burst.buyPressure;
    sellPressure += burst.sellPressure;
    burstCount += burst.orderCount;
    const activeNotional = Math.max(burst.buyPressure, burst.sellPressure);
    if (activeNotional > dominantNotional) {
      dominantNotional = activeNotional;
      dominantStrategy = cohort.strategy;
    }

    cohort.flowMemory = clamp(cohort.flowMemory * 0.76 + (burst.buyPressure - burst.sellPressure) / Math.max(1, stock.currentLiquidity) * 78, -100, 100);
    updateCohortInventory(cohort, burst.buyPressure, burst.sellPressure);

    heatDelta += intent.heatDelta;
    sentimentDelta += intent.sentimentDelta;
    attentionDelta += intent.attentionDelta;
    if (intent.note && activeNotional > stock.currentLiquidity * 0.01) notes.push(intent.note);
  }

  return {
    buyPressure,
    sellPressure,
    heatDelta: clamp(heatDelta, 0, 1.4),
    sentimentDelta: clamp(sentimentDelta, -1, 1),
    attentionDelta: clamp(attentionDelta, 0, 1.4),
    burstCount,
    dominantStrategy,
    dominantNotional,
    notes
  };
}

function updateCohortComposition(
  cohort: ShrimpCohort,
  stock: Stock,
  rng: ReturnType<typeof createRng>,
  valuation: ValuationSnapshot,
  context: MarketContext
): void {
  const activityNoise = rng.float(-0.45, 0.45);
  const convictionNoise = rng.float(-0.28, 0.28);
  const eventSpeed = context.panicCascade || context.limitUpMagnet ? 1.55 : context.supportFailure ? 1.25 : 1;
  rotateCohortCapital(cohort, stock, context);

  if (cohort.strategy === "boardChaser") {
    const targetActivity =
      28 +
      context.boardChaseScore * 0.52 +
      (context.previousBoardWasHot ? 28 : 0) +
      (context.tick < 70 && context.previousBoardWasHot ? 18 : 0) -
      (context.failedBoardFollowThrough ? 18 : 0) +
      (context.limitUpMagnet ? 30 : 0) -
      (context.panicCascade ? 28 : 0);
    cohort.activity = moveToward(cohort.activity, targetActivity, 0.08 * eventSpeed, activityNoise);
    cohort.conviction = moveToward(cohort.conviction, targetActivity + stock.retail.boardFaith * 0.2, 0.07 * eventSpeed, convictionNoise);
  } else if (cohort.strategy === "momentumScalper") {
    const targetActivity =
      35 +
      Math.abs(stock.momentum) * 0.42 +
      stock.microstructure.liquidityStress * 0.28 +
      stock.attention * 0.16 +
      (context.panicCascade || context.limitUpMagnet ? 14 : 0);
    cohort.activity = moveToward(cohort.activity, targetActivity, 0.07 * eventSpeed, activityNoise);
    cohort.conviction = moveToward(cohort.conviction, 38 + Math.abs(stock.momentum) * 0.32 + (context.fightBack ? 4 : 0), 0.05 * eventSpeed, convictionNoise);
  } else if (cohort.strategy === "dipBuyer") {
    const targetActivity =
      28 +
      context.washoutScore * 0.44 +
      (context.fightBack ? 22 : 0) +
      Math.max(0, -valuation.valuationGap) * 20 -
      (context.panicCascade && !context.fightBack ? 14 : 0);
    cohort.activity = moveToward(cohort.activity, targetActivity, 0.08 * eventSpeed, activityNoise);
    cohort.conviction = moveToward(cohort.conviction, targetActivity + stock.financialHealth * 0.12, 0.06 * eventSpeed, convictionNoise);
  } else if (cohort.strategy === "panicCutter") {
    const targetActivity =
      22 +
      context.fearScore * 0.58 +
      (context.noBidSlide ? 24 : 0) +
      (context.supportFailure ? 18 : 0) +
      (context.panicCascade ? 34 : 0) -
      (context.fightBack ? 14 : 0);
    cohort.activity = moveToward(cohort.activity, targetActivity, 0.08 * eventSpeed, activityNoise);
    cohort.conviction = moveToward(cohort.conviction, targetActivity + stock.retail.fear * 0.14, 0.07 * eventSpeed, convictionNoise);
  } else if (cohort.strategy === "valueHolder") {
    const valueSignal = Math.max(0, -valuation.valuationGap) * 45 + stock.financialHealth * 0.2 + Math.max(0, 15 - stock.pe) * 1.5;
    cohort.activity = moveToward(
      cohort.activity,
      18 + valueSignal + Math.max(0, -context.dayChangePct - 1.2) * 4 - (context.panicCascade && stock.financialHealth < 55 ? 10 : 0),
      0.035 * (context.fightBack ? 1.4 : 1),
      activityNoise * 0.35
    );
    cohort.conviction = moveToward(cohort.conviction, 48 + valueSignal, 0.03, convictionNoise * 0.25);
  } else {
    cohort.activity = moveToward(
      cohort.activity,
      42 + stock.attention * 0.22 + stock.microstructure.liquidityStress * 0.2 + (context.panicCascade || context.limitUpMagnet ? 14 : 0),
      0.05 * eventSpeed,
      activityNoise
    );
    cohort.conviction = moveToward(cohort.conviction, 34 + stock.retail.attention * 0.18, 0.04 * eventSpeed, convictionNoise);
  }

  cohort.activity = clamp(cohort.activity, 4, 100);
  cohort.conviction = clamp(cohort.conviction, 0, 100);
}

function calculateCohortIntent(
  cohort: ShrimpCohort,
  stock: Stock,
  rng: ReturnType<typeof createRng>,
  newsImpact: number,
  valuation: ValuationSnapshot,
  context: MarketContext
): {
  buyIntent: number;
  sellIntent: number;
  urgency: number;
  heatDelta: number;
  sentimentDelta: number;
  attentionDelta: number;
  note?: string;
} {
  const activeCapital = cohort.capital * clamp(cohort.activity / 100, 0.04, 1.25);
  const conviction = clamp(cohort.conviction / 100, 0.04, 1.25);
  const risk = clamp(cohort.riskAppetite / 100, 0.05, 1.25);
  const noise = rng.float(-0.26, 0.26) + cohort.flowMemory / 420;
  const overvaluation = Math.max(0, valuation.valuationGap);
  let buyScore = 0;
  let sellScore = 0;
  let urgency = 0.6;
  let note: string | undefined;

  if (cohort.strategy === "boardChaser") {
    const magnetBid =
      context.limitUpMagnet
        ? 0.75 + Math.pow(context.limitProgressUp, 2) * 1.15 + Math.max(0, 2.8 - context.upperGapPct) / 3.2
        : 0;
    buyScore =
      Math.max(0, context.boardChaseScore - 54) / 58 +
      (context.previousBoardWasHot && gameTickEarly(context) ? 1.55 : 0) +
      (stock.boardState === "sealedLimitUp" ? 0.55 : stock.boardState === "attackingLimitUp" ? 0.35 : 0) +
      magnetBid +
      Math.max(0, stock.microstructure.flowMemory) / 180 +
      noise -
      (context.previousBoardWasHot ? overvaluation * 0.18 : overvaluation * 0.52);
    sellScore =
      (context.failedBoardFollowThrough ? 0.46 : 0) +
      (context.supportFailure ? 0.46 : 0) +
      (context.panicCascade ? 0.38 : 0) +
      Math.max(0, context.memoryReturn5d - 14) / 28 +
      Math.max(0, context.upStreak - 4) * 0.16 +
      Math.max(0, -context.openChangePct - 0.45) / 3.2 +
      Math.max(0, -stock.microstructure.flowMemory - 8) / 120 -
      (context.fightBack ? 0.18 : 0);
    urgency = context.limitUpMagnet && buyScore > sellScore ? 2.2 : context.failedBoardFollowThrough ? 1.45 : 0.8;
    note = buyScore > sellScore ? "board chasers are queuing for follow-through" : "board chasers are abandoning a failed follow-through";
  } else if (cohort.strategy === "momentumScalper") {
    buyScore =
      Math.max(0, stock.momentum) / 85 +
      Math.max(0, context.lastTickMovePct) * 5 +
      Math.max(0, stock.microstructure.flowMemory) / 150 +
      (context.limitUpMagnet ? 0.45 : 0) +
      noise -
      overvaluation * 0.34;
    sellScore =
      Math.max(0, -stock.momentum) / 85 +
      Math.max(0, -context.lastTickMovePct) * 5 +
      Math.max(0, -stock.microstructure.flowMemory) / 150 +
      (context.panicCascade ? 0.64 + context.limitProgressDown * 0.65 : 0) +
      Math.max(0, context.downStreak - 1) * 0.2 +
      Math.max(0, -context.memoryReturn5d - 7) / 26 +
      overvaluation * 0.22 -
      noise;
    urgency = context.panicCascade || context.limitUpMagnet ? 1.65 : 0.9;
    note = buyScore > sellScore ? "momentum scalpers are lifting offers" : "momentum scalpers are hitting bids";
  } else if (cohort.strategy === "dipBuyer") {
    const fallingKnifeBrake = context.panicCascade && !context.fightBack ? 0.28 : context.supportFailure ? 0.52 : 1;
    const failedBoardBounceBid =
      context.previousBoardWasHot && context.dayChangePct < -4 && context.lowerGapPct > 1.2
        ? 0.42 + stock.retail.dipBuyers / 210 + Math.max(0, -valuation.valuationGap) * 0.3 + context.limitProgressDown * 0.38
        : 0;
    buyScore =
      (Math.max(0, -context.dayChangePct - 0.8) / 6.5 +
        Math.max(0, -valuation.valuationGap) * 0.65 +
        (context.fightBack ? 0.62 : 0) +
        Math.min(0.62, stock.microstructure.liquidityStress / 120) +
        (context.previousBoardWasHot && context.tick < 120 && context.dayChangePct < -1.2 ? 0.34 : 0) +
        Math.max(0, newsImpact) / 120 +
        noise * 0.6 -
        overvaluation * 0.24) *
        fallingKnifeBrake +
      failedBoardBounceBid;
    sellScore =
      Math.max(0, -context.dayChangePct - 7) / 9 +
      (context.noBidSlide ? 0.24 : 0) -
      Math.max(0, -valuation.valuationGap) * 0.2 -
      (context.previousBoardWasHot && context.fightBack ? 0.22 : 0);
    urgency = context.fightBack ? 1.45 : context.panicCascade ? 0.75 : 1;
    note = context.fightBack ? "dip buyers are responding to visible absorption" : "dip buyers are testing the falling tape";
  } else if (cohort.strategy === "panicCutter") {
    buyScore = Math.max(0, context.fightBack ? 0.1 : 0) + Math.max(0, -valuation.valuationGap - 0.28) * 0.18 + noise * 0.35;
    const cascadeFear = Math.pow(clamp((context.fearScore - 48) / 42, 0, 2.2), 1.28);
    sellScore =
      Math.max(0, context.fearScore - 42) / 70 +
      (context.noBidSlide ? 0.55 : 0) +
      (context.supportFailure ? 0.42 : 0) +
      (context.panicCascade ? 0.82 + cascadeFear + context.limitProgressDown * 0.85 : 0) +
      Math.max(0, context.downStreak - 1) * 0.24 +
      context.boardBreaks5d * 0.12 +
      Math.max(0, -context.lastTickMovePct) * 4.2 +
      Math.max(0, -newsImpact) / 95 -
      (context.fightBack ? 0.34 : 0);
    urgency = context.panicCascade ? 2.35 : context.noBidSlide ? 1.55 : 1;
    note = context.noBidSlide ? "panic cutters are accelerating into weak bids" : "nervous holders are trimming risk";
  } else if (cohort.strategy === "valueHolder") {
    const panicDiscount = context.panicCascade && !context.fightBack && valuation.valuationGap > -0.28 ? 0.46 : 1;
    buyScore =
      (Math.max(0, -valuation.valuationGap) * 0.9 +
        Math.max(0, 14 - stock.pe) / 18 +
        Math.max(0, -context.dayChangePct - 0.6) / 10 +
        Math.min(0.35, stock.microstructure.liquidityStress / 180) +
        stock.financialHealth / 250 +
        (context.fightBack ? 0.22 : 0) +
        noise * 0.25) *
      panicDiscount;
    sellScore =
      Math.max(0, valuation.valuationGap - 0.35) * 0.58 +
      Math.max(0, context.dayChangePct - 5) / 16 +
      Math.max(0, 38 - stock.financialHealth) / 180;
    urgency = context.fightBack ? 1.15 : 0.65;
    note = buyScore > sellScore ? "value holders are adding into weakness" : "long-term holders are lightening an expensive move";
  } else {
    const randomLean = rng.float(-1, 1);
    const meanReversion = -context.dayChangePct / 34;
    const eventLean = context.panicCascade ? -0.55 : context.limitUpMagnet ? 0.42 : 0;
    buyScore = Math.max(0, randomLean + meanReversion + noise + eventLean);
    sellScore = Math.max(0, -randomLean - meanReversion - noise - eventLean);
    urgency = context.panicCascade || context.limitUpMagnet ? 1.35 : 0.9;
    note = "noise traders are creating small two-way prints";
  }

  const intentMultiplier = 0.018 * clamp(0.75 + urgency * 0.24, 0.75, 1.42);
  const buyIntent = activeCapital * Math.max(0, buyScore) * conviction * risk * intentMultiplier;
  const inventoryBias = clamp(cohort.inventoryNotional / Math.max(1, cohort.capital), 0.08, 1.1);
  const sellIntent = activeCapital * Math.max(0, sellScore) * conviction * (0.55 + inventoryBias * 0.55) * intentMultiplier;
  const signedScore = buyScore - sellScore;

  return {
    buyIntent,
    sellIntent,
    urgency,
    heatDelta: clamp(Math.max(buyScore, sellScore) * cohort.activity / 3_600, 0, 0.2),
    sentimentDelta: clamp(signedScore * 0.055, -0.22, 0.22),
    attentionDelta: clamp(Math.max(buyScore, sellScore) * cohort.activity / 4_800, 0, 0.16),
    note
  };
}

function quantizeSmallOrderBurst(
  cohort: ShrimpCohort,
  stock: Stock,
  rng: ReturnType<typeof createRng>,
  rawBuyIntent: number,
  rawSellIntent: number,
  urgency: number
): { buyPressure: number; sellPressure: number; orderCount: number } {
  const buyIntent = Math.min(rawBuyIntent, Math.max(0, cohort.capital) * clamp(0.1 + urgency * 0.045, 0.1, 0.24));
  const sellIntent = Math.min(rawSellIntent, Math.max(0, cohort.inventoryNotional) * clamp(0.16 + urgency * 0.06, 0.16, 0.34));
  const buyBurst = quantizeSide(cohort, stock, rng, buyIntent, urgency);
  const sellBurst = quantizeSide(cohort, stock, rng, sellIntent, urgency);

  return {
    buyPressure: buyBurst.notional,
    sellPressure: sellBurst.notional,
    orderCount: buyBurst.count + sellBurst.count
  };
}

function quantizeSide(
  cohort: ShrimpCohort,
  stock: Stock,
  rng: ReturnType<typeof createRng>,
  notional: number,
  urgency: number
): { notional: number; count: number } {
  if (notional <= 0) return { notional: 0, count: 0 };

  const sharesPerOrder = Math.max(100, Math.round(cohort.orderSize * rng.float(0.55, 1.75) / 100) * 100);
  const orderNotional = Math.max(100 * stock.price, sharesPerOrder * stock.price);
  const expectedCount = notional / orderNotional;
  const count = Math.min(320, Math.max(1, Math.round(expectedCount * rng.float(0.38, 1.82 + urgency * 0.22))));
  const clusterChance = clamp(0.05 + urgency * 0.08 + stock.microstructure.liquidityStress / 520, 0.05, 0.34);
  const clusterMultiplier = rng.chance(clusterChance) ? rng.float(1.35, 2.55 + urgency * 0.32) : rng.float(0.68, 1.18);
  const realized = roundMoney(orderNotional * count * clusterMultiplier);

  return {
    notional: Math.min(notional * (1.05 + urgency * 0.28), realized),
    count
  };
}

function updateCohortInventory(cohort: ShrimpCohort, buyPressure: number, sellPressure: number): void {
  const buySettlement = buyPressure * 0.34;
  const sellSettlement = sellPressure * 0.42;

  cohort.capital = roundMoney(clamp(cohort.capital - buySettlement + sellSettlement * 0.96, 100_000, cohort.capital * 1.08 + sellSettlement));
  cohort.inventoryNotional = roundMoney(clamp(cohort.inventoryNotional + buySettlement - sellSettlement, 0, cohort.capital * 1.25));
}

function rotateCohortCapital(cohort: ShrimpCohort, stock: Stock, context: MarketContext): void {
  const target = getCohortCapitalTarget(cohort, stock, context);
  const rotationSpeed =
    cohort.strategy === "boardChaser" && context.previousBoardWasHot && context.tick < 90
      ? 0.07
      : cohort.strategy === "dipBuyer" && context.dayChangePct < -2
        ? 0.045
        : cohort.strategy === "panicCutter" && context.noBidSlide
          ? 0.04
          : cohort.strategy === "valueHolder"
            ? 0.016
            : 0.012;

  cohort.capital = roundMoney(clamp(cohort.capital + (target - cohort.capital) * rotationSpeed, 100_000, target * 1.08));
  cohort.inventoryNotional = roundMoney(clamp(cohort.inventoryNotional, 0, cohort.capital * 1.25));
}

function getCohortCapitalTarget(cohort: ShrimpCohort, stock: Stock, context: MarketContext): number {
  const attentionBoost = 0.75 + stock.attention / 95 + stock.heat / 150;
  if (cohort.strategy === "boardChaser") {
    return (
      stock.baseLiquidity *
      attentionBoost *
      (context.previousBoardWasHot ? 1.65 : 0.72) *
      (context.limitUpMagnet ? 1.55 : 1) *
      (context.panicCascade ? 0.58 : 1) *
      (stock.marketCap > 50_000_000_000 ? 0.65 : 1.05)
    );
  }
  if (cohort.strategy === "momentumScalper") {
    return stock.baseLiquidity * (0.62 + Math.abs(stock.momentum) / 105 + stock.attention / 180 + (context.panicCascade || context.limitUpMagnet ? 0.22 : 0));
  }
  if (cohort.strategy === "dipBuyer") {
    return stock.baseLiquidity * (0.58 + stock.retail.dipBuyers / 95 + Math.max(0, -context.dayChangePct) / 8) * (context.panicCascade && !context.fightBack ? 0.72 : 1);
  }
  if (cohort.strategy === "panicCutter") {
    return stock.baseLiquidity * (0.45 + stock.retail.bagholders / 120 + stock.retail.panicSellers / 130 + (context.panicCascade ? 0.48 : 0));
  }
  if (cohort.strategy === "valueHolder") {
    return stock.baseLiquidity * (0.7 + stock.financialHealth / 95 + Math.max(0, 14 - stock.pe) / 20) * (stock.marketCap > 50_000_000_000 ? 1.3 : 0.9);
  }
  return stock.baseLiquidity * (0.58 + stock.attention / 180);
}

function calculateLegacyCrowdPressure(
  stock: Stock,
  rng: ReturnType<typeof createRng>,
  valuation: ValuationSnapshot,
  context: MarketContext
): LegacyPressure {
  const panicFatigue =
    stock.boardState === "limitDown" || stock.boardState === "panic"
      ? clamp((stock.retail.panicSellers + stock.retail.fear - stock.retail.dipBuyers * 1.2) / 220, 0.08, 0.72) *
        (context.limitDownDays5d >= 2 ? 0.48 : context.limitDownDays5d === 1 ? 0.72 : 1)
      : 1;
  const themeBurstChance = clamp((context.boardChaseScore - 66) / 190 + stock.retail.gamblers / 1_500, 0.006, 0.14);
  const washoutBurstChance = clamp((context.washoutScore - 36) / 170 + stock.retail.dipBuyers / 1_200, 0.01, 0.16);
  const panicBurstChance = clamp((context.fearScore - 50) / 150 + (context.panicCascade ? 0.22 : 0) + stock.retail.panicSellers / 1_400, 0.015, 0.36);
  const themeBurst = rng.chance(themeBurstChance + (context.limitUpMagnet ? 0.12 : 0));
  const washoutBurst = rng.chance(washoutBurstChance);
  const panicBurst = rng.chance(panicBurstChance);
  const distressedDiscount =
    stock.financialHealth < 42 &&
    valuation.valuationGap < -0.12 &&
    (stock.boardState === "limitDown" || stock.boardState === "panic" || context.dayChangePct <= -7);

  let buyPressure = 0;
  let sellPressure = 0;
  let heatDelta = 0;
  let sentimentDelta = 0;
  let attentionDelta = 0;
  const notes: string[] = [];

  if (context.storyScore > 44 && stock.boardState !== "limitDown") {
    const ignition = stock.currentLiquidity * ((context.storyScore - 44) / 100) * 0.07;
    buyPressure += ignition;
    heatDelta += ignition > stock.currentLiquidity * 0.01 ? 0.04 : 0;
  }

  if (context.boardChaseScore > 62 && stock.boardState !== "limitDown") {
    const burstScale = context.limitUpMagnet ? rng.float(1.15, 2.6) : themeBurst ? rng.float(1.35, 2.5) : 0.12;
    const qualityBrake = valuation.valuationGap > 0.7 && stock.financialHealth < 55 ? 0.55 : 1;
    const magnetBoost = context.limitUpMagnet ? 1 + context.limitProgressUp * 0.8 + Math.max(0, 2.5 - context.upperGapPct) / 4 : 1;
    const chase = stock.currentLiquidity * ((context.boardChaseScore - 62) / 70) * 0.2 * burstScale * qualityBrake * magnetBoost;
    buyPressure += chase;
    heatDelta += themeBurst || context.limitUpMagnet ? 0.46 : 0.06;
    sentimentDelta += themeBurst || context.limitUpMagnet ? 0.24 : 0.04;
    attentionDelta += themeBurst || context.limitUpMagnet ? 0.42 : 0.08;
    if (themeBurst || context.limitUpMagnet) notes.push("speculators are chasing a board attempt");
  }

  if (context.washoutScore > 28) {
    const burstScale = washoutBurst ? rng.float(1.15, 1.95) : 0.38;
    const healthBrake = stock.financialHealth < 35 ? 0.66 : stock.financialHealth < 50 ? 0.82 : 1.08;
    const bargainBid = stock.currentLiquidity * ((context.washoutScore - 24) / 66) * 0.26 * burstScale * healthBrake;
    buyPressure += bargainBid;
    heatDelta += washoutBurst ? 0.24 : 0.05;
    sentimentDelta += washoutBurst ? 0.22 : 0.04;
    attentionDelta += washoutBurst ? 0.26 : 0.08;
    notes.push(washoutBurst ? "dip buyers are organizing around a washout" : "dip buyers are quietly absorbing fear");
  }

  if (distressedDiscount) {
    const rescueBid =
      stock.currentLiquidity *
      clamp(
        0.12 +
          Math.max(0, -valuation.valuationGap - 0.08) * 0.5 +
          stock.retail.dipBuyers / 820 +
          context.limitProgressDown * 0.12 +
          context.limitDownDays5d * 0.1,
        0.12,
        0.68
      );
    buyPressure += rescueBid;
    heatDelta += 0.14;
    sentimentDelta += 0.09;
    attentionDelta += 0.16;
    notes.push("speculative rescue bids are testing the washout");
  }

  if (context.fearScore > 48) {
    const valueFatigue = valuation.valuationGap < -0.18 ? 0.45 : valuation.valuationGap < 0.08 ? 0.68 : 1;
    const fatigueBrake = panicFatigue * valueFatigue * (context.panicCascade && !context.fightBack ? 1.32 : 1);
    const burstScale = panicBurst ? rng.float(1.35, 2.45 + context.limitProgressDown * 0.8) : context.panicCascade ? 1.18 : 1;
    const panicSupply = stock.currentLiquidity * ((context.fearScore - 45) / 72) * 0.14 * fatigueBrake * burstScale;
    sellPressure += panicSupply;
    heatDelta += stock.boardState === "limitDown" ? 0.09 : 0.18;
    sentimentDelta -= context.panicCascade ? 0.24 : 0.14;
    attentionDelta += context.panicCascade ? 0.18 : 0;
    if (context.fearScore > 68 || context.panicCascade) notes.push("panic sellers are still hitting bids");
  }

  if (context.memoryReturn5d > 12 || context.upStreak >= 4) {
    const crowdedExit =
      stock.currentLiquidity *
      (Math.max(0, context.memoryReturn5d - 10) / 58 + Math.max(0, context.upStreak - 3) * 0.035 + context.resistanceScore / 1_200);
    sellPressure += crowdedExit;
    heatDelta += crowdedExit > stock.currentLiquidity * 0.08 ? 0.18 : 0.06;
    sentimentDelta -= crowdedExit > stock.currentLiquidity * 0.1 ? 0.12 : 0.04;
    if (crowdedExit > stock.currentLiquidity * 0.08) notes.push("multi-day winners are meeting supply");
  }

  const crowdedStrength =
    context.dayChangePct > 6 ||
    stock.boardState === "attackingLimitUp" ||
    stock.boardState === "weakSeal" ||
    stock.boardState === "sealedLimitUp" ||
    stock.retail.greed > 68 ||
    stock.heat > 62;
  if (context.dayChangePct > 6 || (valuation.valuationGap > 0.55 && crowdedStrength)) {
    const profitTaking =
      stock.currentLiquidity * (Math.max(0, context.dayChangePct - 5.5) / 46 + Math.max(0, valuation.valuationGap - 0.42)) * 0.11;
    sellPressure += profitTaking;
    heatDelta += 0.08;
    if (profitTaking > stock.currentLiquidity * 0.08) notes.push("fast money is taking profits into strength");
  }

  return {
    buyPressure: clamp(buyPressure, 0, stock.currentLiquidity * (themeBurst || context.limitUpMagnet ? 1.35 : 0.78)),
    sellPressure: clamp(sellPressure, 0, stock.currentLiquidity * (context.panicCascade ? 1.28 : 0.82)),
    heatDelta: clamp(heatDelta, 0, 1.2),
    sentimentDelta: clamp(sentimentDelta, -0.9, 0.9),
    attentionDelta: clamp(attentionDelta, 0, 1.2),
    notes
  };
}

function getShrimpPressureCap(stock: Stock, side: "buy" | "sell", dominantStrategy: ShrimpStrategy): number {
  const base = dominantStrategy === "boardChaser" ? 2.05 : dominantStrategy === "panicCutter" ? 2.05 : dominantStrategy === "valueHolder" ? 1 : 1.28;
  const boardBoost = stock.boardState === "sealedLimitUp" || stock.boardState === "limitDown" ? 0.5 : 0;
  const sideBoost = side === "buy" && dominantStrategy === "boardChaser" ? 0.45 : side === "sell" && dominantStrategy === "panicCutter" ? 0.55 : 0;
  return base + boardBoost + sideBoost;
}

function moveToward(current: number, target: number, speed: number, noise: number): number {
  return current + (target - current) * speed + noise;
}

function gameTickEarly(context: MarketContext): boolean {
  return context.tick < 92 && context.dayChangePct > -4.5;
}
