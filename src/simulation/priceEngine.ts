import { clamp, GAME_CONFIG } from "../game/config";
import { updateValuationFromPrice } from "../game/fundamentals";
import { createRng } from "../game/rng";
import type { ExecutionFill, GameState, MicrostructureState, Pressure, PressureBreakdown, Stock } from "../game/types";
import type { AmbientTapeTrace } from "./ambientTape";
import { getLimitRatio, getLowerLimit, getUpperLimit, roundPrice } from "./boardEngine";
import { getMarketMemory, type MarketMemorySnapshot } from "./marketMemory";
import { getMarketCapClass } from "./marketDepth";

type PressureInput = Partial<Omit<PressureBreakdown, "noise">> & {
  noise?: number;
};

export type TapePriceContext = {
  ambientTape?: AmbientTapeTrace;
  playerFills?: ExecutionFill[];
  whaleTrades?: ExecutionFill[];
};

const zeroBreakdown: PressureBreakdown = {
  playerBuyPressure: 0,
  playerSellPressure: 0,
  retailBuyPressure: 0,
  retailSellPressure: 0,
  whaleBuyPressure: 0,
  whaleSellPressure: 0,
  quantBuyPressure: 0,
  quantSellPressure: 0,
  institutionBuyPressure: 0,
  institutionSellPressure: 0,
  collectiveBuyPressure: 0,
  collectiveSellPressure: 0,
  fundamentalBuyPressure: 0,
  fundamentalSellPressure: 0,
  newsBuyPressure: 0,
  newsSellPressure: 0,
  noise: 0
};

const BASELINE_TICK_SECONDS = 5;

export function createPressure(game: GameState, stock: Stock, input: PressureInput): Pressure {
  const rng = createRng(`${game.rngSeed}:day:${game.day}:tick:${game.tick}:stock:${stock.id}`);
  const emotionalNoiseScale =
    1 +
    stock.heat / 180 +
    Math.max(0, Math.max(stock.retail.fear, stock.retail.greed) - 68) / 85 +
    stock.microstructure.liquidityStress / 160;
  const breakdown: PressureBreakdown = {
    ...zeroBreakdown,
    ...input,
    noise: input.noise ?? rng.float(-0.11, 0.11) * stock.currentLiquidity * (game.market.volatility / 100) * emotionalNoiseScale
  };

  const buyPressure =
    breakdown.playerBuyPressure +
    breakdown.retailBuyPressure +
    breakdown.whaleBuyPressure +
    breakdown.quantBuyPressure +
    breakdown.institutionBuyPressure +
    breakdown.collectiveBuyPressure +
    breakdown.fundamentalBuyPressure +
    breakdown.newsBuyPressure +
    Math.max(0, breakdown.noise);

  const sellPressure =
    breakdown.playerSellPressure +
    breakdown.retailSellPressure +
    breakdown.whaleSellPressure +
    breakdown.quantSellPressure +
    breakdown.institutionSellPressure +
    breakdown.collectiveSellPressure +
    breakdown.fundamentalSellPressure +
    breakdown.newsSellPressure +
    Math.max(0, -breakdown.noise);

  return {
    ...breakdown,
    buyPressure,
    sellPressure,
    imbalance: buyPressure - sellPressure
  };
}

export function updateLiquidity(game: GameState, stock: Stock): void {
  const marketLiquidityModifier = game.market.liquidity / 58;
  const attentionModifier = 0.82 + stock.attention / 140;
  const stressModifier = clamp(1 - stock.microstructure.liquidityStress / 175, 0.46, 1.04);
  const panicThinModifier =
    stock.boardState === "panic" || stock.boardState === "limitDown"
      ? clamp(1 - (stock.retail.fear + stock.retail.panicSellers + stock.heat) / 520, 0.54, 1)
      : 1;
  const boardStateModifier =
    stock.boardState === "sealedLimitUp"
      ? 0.38
      : stock.boardState === "weakSeal"
        ? 0.72
        : stock.boardState === "panic" || stock.boardState === "limitDown"
          ? 0.36
          : 1;

  stock.currentLiquidity = Math.max(
    1_000_000,
    stock.baseLiquidity * marketLiquidityModifier * attentionModifier * boardStateModifier * stressModifier * panicThinModifier
  );
}

export function applyExecutionPrice(stock: Stock, executionPrice: number): void {
  if (stock.halted || executionPrice <= 0) return;

  const upperLimit = getUpperLimit(stock);
  const lowerLimit = getLowerLimit(stock);
  stock.microPrice = clamp(executionPrice, lowerLimit, upperLimit);
  stock.price = roundPrice(stock.microPrice);
  updatePriceDerivedFields(stock);
}

export function applyResidualPriceImpact(
  game: GameState,
  stock: Stock,
  pressure: Pressure,
  effectiveDepth: number,
  context: TapePriceContext = {}
): void {
  if (stock.halted) return;

  const upperLimit = getUpperLimit(stock);
  const lowerLimit = getLowerLimit(stock);
  const capClass = getMarketCapClass(stock);
  const rng = createRng(`${game.rngSeed}:tape:${game.day}:${game.tick}:${stock.id}:${stock.chart.length}`);
  const state = stock.microstructure;
  const boardAdjustedImbalance = getBoardAdjustedImbalance(stock, pressure, upperLimit, lowerLimit);
  const rawExecutionNet = getSignedFillNotional(context.playerFills) + getSignedFillNotional(context.whaleTrades);
  const executionNet = getBoardAdjustedExecutionNet(stock, rawExecutionNet, upperLimit, lowerLimit);
  const executionGross = getGrossFillNotional(context.playerFills) + getGrossFillNotional(context.whaleTrades);
  const ambientMatched = context.ambientTape?.matchedNotional ?? 0;
  const depth = Math.max(1, effectiveDepth);
  const netFlowRatio = clamp((boardAdjustedImbalance + executionNet * 0.72) / depth, -3.2, 3.2);
  const grossFlowRatio = clamp((pressure.buyPressure + pressure.sellPressure + executionGross + ambientMatched) / depth, 0, 5);
  const executionShock = clamp(executionNet / depth, -2.6, 2.6);
  const timeScale = Math.max(0.2, GAME_CONFIG.tickDurationSeconds);
  const priceBefore = stock.price;
  const currentPrice = stock.microPrice ?? stock.price;
  const dayChangePct = ((currentPrice - stock.previousClose) / stock.previousClose) * 100;
  const limitPct = getLimitRatio(stock) * 100;
  const memory = getMarketMemory(game, stock);

  updateTapeState(state, {
    capClass,
    executionShock,
    grossFlowRatio,
    netFlowRatio,
    rng,
    timeScale
  });

  const directionalTicks =
    (netFlowRatio * getDirectionalTickScale(capClass) + state.flowMemory * 0.034 + state.shockMemory * 0.024) *
    getCapImpactMultiplier(capClass);
  const extension = clamp(dayChangePct / Math.max(1, limitPct), -1, 1);
  const reversionTicks = -extension * (0.22 + state.liquidityStress / 92 + Math.abs(state.flowMemory) / 360);
  const jitterTicks = sampleTriangular(rng) * getJitterScale(game, stock, grossFlowRatio);
  const battleTicks = sampleBattleImpulse(rng, stock, state, netFlowRatio, executionShock);
  const cascadeTicks = sampleCascadeImpulse(rng, stock, state, pressure, netFlowRatio, dayChangePct, limitPct, memory);
  const emotionalTicks = getEmotionalBreakTicks(stock, pressure, netFlowRatio, dayChangePct, limitPct, memory);
  const printTicks = (directionalTicks + reversionTicks + jitterTicks + battleTicks + cascadeTicks + emotionalTicks) * timeScale;
  const boardAdjustedPrintTicks = enforceQueuePin(stock, pressure, rawExecutionNet, maybeThinPrint(printTicks, rng, state, grossFlowRatio), upperLimit, lowerLimit);
  const nextMicroTicks = currentPrice * 100 + boardAdjustedPrintTicks;
  const unclampedNextPrice = nextMicroTicks / 100;
  let nextPrice = clamp(unclampedNextPrice, lowerLimit, upperLimit);
  if (nextPrice === lowerLimit && unclampedNextPrice < lowerLimit && stock.price > lowerLimit + 0.01 && stock.sellQueue <= 0) {
    nextPrice = lowerLimit + 0.01;
  }

  stock.microPrice = nextPrice;
  stock.price = roundPrice(stock.microPrice);
  applyExecutionAftermath(stock, rawExecutionNet, executionGross, depth);
  updateLastPrintSign(state, stock.price - priceBefore);
  updatePriceDerivedFields(stock);
}

function updateTapeState(
  state: MicrostructureState,
  args: {
    capClass: ReturnType<typeof getMarketCapClass>;
    executionShock: number;
    grossFlowRatio: number;
    netFlowRatio: number;
    rng: ReturnType<typeof createRng>;
    timeScale: number;
  }
): void {
  const memoryDecay = args.capClass === "large" ? 0.88 : args.capClass === "mid" ? 0.84 : 0.79;
  const stressDecay = args.capClass === "large" ? 0.9 : args.capClass === "mid" ? 0.87 : 0.84;
  const noiseMemory = sampleTriangular(args.rng) * (0.4 + state.liquidityStress / 90);
  const memoryInput = clamp(args.netFlowRatio * 22 + state.shockMemory * 0.08 + noiseMemory, -30, 30);
  const stressInput = (args.grossFlowRatio * 6.5 + Math.abs(args.netFlowRatio) * 5 + Math.abs(args.executionShock) * 18) * args.timeScale;

  state.flowMemory = clamp(state.flowMemory * memoryDecay + memoryInput * args.timeScale, -100, 100);
  state.shockMemory = clamp(state.shockMemory * 0.72 + args.executionShock * 42 * args.timeScale, -100, 100);
  state.liquidityStress = clamp(state.liquidityStress * stressDecay + stressInput, 0, 100);
}

function getDirectionalTickScale(capClass: ReturnType<typeof getMarketCapClass>): number {
  if (capClass === "large") return 2.6;
  if (capClass === "mid") return 4.8;
  return 7.2;
}

function getCapImpactMultiplier(capClass: ReturnType<typeof getMarketCapClass>): number {
  if (capClass === "large") return 0.72;
  if (capClass === "mid") return 0.95;
  return 1.18;
}

function getJitterScale(game: GameState, stock: Stock, grossFlowRatio: number): number {
  const capClass = getMarketCapClass(stock);
  const capNoise = capClass === "large" ? 0.34 : capClass === "mid" ? 0.48 : 0.68;
  const volatilityNoise = game.market.volatility / 180;
  const attentionNoise = stock.attention / 260;
  const stressNoise = stock.microstructure.liquidityStress / 70;
  const emotionNoise = Math.max(0, Math.max(stock.retail.fear, stock.retail.greed) - 64) / 170 + stock.heat / 300;
  const flowNoise = Math.min(1.1, grossFlowRatio * 0.2);
  return clamp(capNoise + volatilityNoise + attentionNoise + stressNoise + emotionNoise + flowNoise, 0.22, capClass === "large" ? 1.9 : 3.8);
}

function sampleBattleImpulse(
  rng: ReturnType<typeof createRng>,
  stock: Stock,
  state: MicrostructureState,
  netFlowRatio: number,
  executionShock: number
): number {
  const flowSign = signOrZero(netFlowRatio || state.flowMemory || executionShock);
  if (flowSign === 0) return 0;

  const stress = state.liquidityStress;
  const retailCounterForce = getRetailCounterForce(stock, flowSign);
  const washoutCounterChance =
    flowSign < 0
      ? clamp(stock.retail.dipBuyers / 430 + stock.retail.bagholders / 720 + Math.max(0, -stock.momentum - 16) / 260, 0, 0.34)
      : 0;
  const profitTakingChance =
    flowSign > 0
      ? clamp(stock.costDistribution.deepProfit / 280 + stock.costDistribution.profit / 520 + Math.max(0, stock.momentum - 26) / 310, 0, 0.28)
      : 0;
  const counterChance = clamp(
    0.035 + stress / 155 + Math.abs(executionShock) * 0.22 + washoutCounterChance + profitTakingChance + retailCounterForce,
    0.035,
    0.78
  );
  const pocketChance = clamp(Math.max(0, Math.abs(netFlowRatio) - 0.18) * 0.23 + stress / 320, 0, 0.28);
  const boardRisk = stock.boardState === "panic" || stock.boardState === "brokenBoard" ? 0.45 : stock.boardState === "attackingLimitUp" ? 0.35 : 0;

  let impulse = 0;
  if (rng.chance(pocketChance + boardRisk * 0.04)) {
    impulse += flowSign * rng.float(0.65, 2.8 + stress / 38);
  }
  if (rng.chance(counterChance)) {
    const counterScale =
      flowSign < 0
        ? 0.95 + stock.retail.dipBuyers / 105 + retailCounterForce * 2.4
        : 0.86 + (stock.costDistribution.deepProfit + stock.costDistribution.profit) / 190 + retailCounterForce * 2;
    impulse -= flowSign * rng.float(0.6, 2.9 + stress / 38) * counterScale;
  }
  if (state.lastPrintSign !== 0 && rng.chance(0.08 + stress / 260)) {
    impulse += state.lastPrintSign * rng.float(0.15, 0.9);
  }

  return impulse;
}

function sampleCascadeImpulse(
  rng: ReturnType<typeof createRng>,
  stock: Stock,
  state: MicrostructureState,
  pressure: Pressure,
  netFlowRatio: number,
  dayChangePct: number,
  limitPct: number,
  memory: MarketMemorySnapshot
): number {
  const imbalanceRatio = pressure.imbalance / Math.max(1, stock.currentLiquidity);
  const downProgress = clamp(-dayChangePct / Math.max(1, limitPct), 0, 1);
  const upProgress = clamp(dayChangePct / Math.max(1, limitPct), 0, 1);
  const panicTape =
    (stock.boardState === "panic" ||
      stock.boardState === "limitDown" ||
      downProgress > 0.38 ||
      memory.downStreak >= 3 ||
      memory.boardBreaks5d > 1 ||
      memory.lastTickMovePct < -0.45 ||
      (stock.retail.fear > 80 && stock.retail.panicSellers > 66 && stock.heat > 54)) &&
    pressure.sellPressure > pressure.buyPressure * 1.16 &&
    (state.flowMemory < -10 || netFlowRatio < -0.16 || memory.lastTickMovePct < -0.38);
  const squeezeTape =
    (stock.boardState === "attackingLimitUp" || stock.boardState === "weakSeal" || stock.boardState === "sealedLimitUp" || upProgress > 0.58) &&
    pressure.buyPressure > pressure.sellPressure * 1.35 &&
    (state.flowMemory > 8 || netFlowRatio > 0.18);
  const stressScale = 1 + state.liquidityStress / 55;

  let impulse = 0;
  if (
    panicTape &&
    rng.chance(
      clamp(
        0.22 +
          downProgress * 0.38 +
          stock.retail.fear / 560 +
          Math.max(0, -imbalanceRatio) * 0.13 +
          Math.max(0, memory.downStreak - 1) * 0.05 +
          memory.boardBreaks5d * 0.03,
        0.22,
        0.82
      )
    )
  ) {
    impulse -= rng.float(1.8, 6.9 * stressScale * (1 + stock.heat / 280 + Math.max(0, memory.downStreak - 1) * 0.035));
  }
  if (squeezeTape && rng.chance(clamp(0.16 + upProgress * 0.3 + Math.max(0, imbalanceRatio) * 0.1, 0.16, 0.62))) {
    impulse += rng.float(1.1, 5.6 * stressScale);
  }

  const profitResistance =
    (dayChangePct > 4.2 || memory.return5d > 12 || memory.upStreak >= 4) &&
    (stock.costDistribution.deepProfit + stock.costDistribution.profit > 70 || pressure.sellPressure > stock.currentLiquidity * 0.42);
  if (profitResistance && rng.chance(clamp(0.08 + upProgress * 0.16 + stock.costDistribution.deepProfit / 420, 0.08, 0.34))) {
    impulse -= rng.float(1.1, 4.8 + state.liquidityStress / 38 + Math.max(0, memory.upStreak - 3) * 0.8);
  }

  const absorptionResistance =
    (dayChangePct < -2.5 || memory.drawdownFrom10dHigh < -9) &&
    pressure.buyPressure > stock.currentLiquidity * (memory.limitUpDays5d > 0 ? 0.1 : 0.16) &&
    (stock.retail.dipBuyers > 34 || stock.financialHealth > 58 || stock.retail.boardFaith > 48 || memory.limitUpDays5d > 0);
  if (
    absorptionResistance &&
    rng.chance(clamp(0.11 + downProgress * 0.18 + stock.retail.dipBuyers / 520 + memory.limitUpDays5d * 0.05, 0.11, 0.42))
  ) {
    impulse += rng.float(1.2, 5.4 + state.liquidityStress / 40 + memory.limitUpDays5d * 0.9);
  }

  const failedBoardChurn =
    memory.limitUpDays5d > 0 &&
    stock.boardState !== "limitDown" &&
    dayChangePct < -1.5 &&
    downProgress < 0.96;
  if (failedBoardChurn && rng.chance(clamp(0.34 + downProgress * 0.34 + memory.limitUpDays5d * 0.08, 0.34, 0.72))) {
    impulse += rng.float(1.8, 8.4 + state.liquidityStress / 30);
  }

  return impulse;
}

function getEmotionalBreakTicks(
  stock: Stock,
  pressure: Pressure,
  netFlowRatio: number,
  dayChangePct: number,
  limitPct: number,
  memory: MarketMemorySnapshot
): number {
  const downProgress = clamp(-dayChangePct / Math.max(1, limitPct), 0, 1);
  const upProgress = clamp(dayChangePct / Math.max(1, limitPct), 0, 1);
  const sellImbalance = clamp((pressure.sellPressure - pressure.buyPressure) / Math.max(1, stock.currentLiquidity), 0, 3.4);
  const buyImbalance = clamp((pressure.buyPressure - pressure.sellPressure) / Math.max(1, stock.currentLiquidity), 0, 3.4);
  const memoryFear = Math.max(0, -memory.return3d - 5) / 24 + Math.max(0, memory.downStreak - 1) * 0.1 + memory.boardBreaks5d * 0.08;
  const panicIntensity =
    clamp((stock.retail.fear - 66) / 34 + memoryFear, 0, 1.15) * clamp((stock.retail.panicSellers - 56) / 44 + memoryFear * 0.75, 0, 1.15);
  const greedIntensity = clamp((stock.retail.greed - 70) / 30, 0, 1) * clamp((stock.retail.boardFaith - 55) / 45, 0, 1);
  const heatMultiplier = 0.55 + stock.heat / 110;
  const noBidMultiplier = stock.buyQueue <= stock.currentLiquidity * 0.03 ? 1.25 : 0.72;
  const noOfferMultiplier = stock.sellQueue <= stock.currentLiquidity * 0.03 ? 1.18 : 0.78;
  let ticks = 0;

  if (panicIntensity > 0 && sellImbalance > 0.18 && netFlowRatio < 0.05) {
    const acceleration = Math.pow(downProgress + 0.35, 1.35);
    ticks -= sellImbalance * panicIntensity * heatMultiplier * noBidMultiplier * acceleration * 10.8;
  }

  if (greedIntensity > 0 && buyImbalance > 0.22 && netFlowRatio > -0.05) {
    const acceleration = Math.pow(upProgress + 0.32, 1.25);
    ticks += buyImbalance * greedIntensity * heatMultiplier * noOfferMultiplier * acceleration * 8.6;
  }

  return clamp(ticks, -42, 34);
}

function getRetailCounterForce(stock: Stock, flowSign: -1 | 0 | 1): number {
  if (flowSign === 0) return 0;

  if (flowSign < 0) {
    const dipActivity = getCohortActivity(stock, "dipBuyer");
    const valueActivity = getCohortActivity(stock, "valueHolder");
    const boardActivity = getCohortActivity(stock, "boardChaser");
    return clamp((dipActivity * 0.7 + valueActivity * 0.45 + boardActivity * 0.32) / 310, 0, 0.34);
  }

  const panicActivity = getCohortActivity(stock, "panicCutter");
  const scalperActivity = getCohortActivity(stock, "momentumScalper");
  return clamp((panicActivity * 0.48 + scalperActivity * 0.28 + stock.costDistribution.profit * 0.35) / 330, 0, 0.28);
}

function getCohortActivity(stock: Stock, strategy: string): number {
  return stock.shrimpCohorts.find((cohort) => cohort.strategy === strategy)?.activity ?? 0;
}

function maybeThinPrint(printTicks: number, rng: ReturnType<typeof createRng>, state: MicrostructureState, grossFlowRatio: number): number {
  const magnitude = Math.abs(printTicks);
  if (magnitude >= 0.2) return printTicks;

  const printChance = clamp(magnitude * 2.4 + state.liquidityStress / 260 + grossFlowRatio * 0.045 + 0.04, 0.04, 0.72);
  return rng.chance(printChance) ? printTicks : printTicks * 0.22;
}

function sampleTriangular(rng: ReturnType<typeof createRng>): number {
  return (rng.float(-1, 1) + rng.float(-1, 1)) / 2;
}

function getSignedFillNotional(fills: ExecutionFill[] | undefined): number {
  return (fills ?? []).reduce((total, fill) => total + (fill.side === "buy" ? fill.filledNotional : -fill.filledNotional), 0);
}

function getGrossFillNotional(fills: ExecutionFill[] | undefined): number {
  return (fills ?? []).reduce((total, fill) => total + fill.filledNotional, 0);
}

function applyExecutionAftermath(stock: Stock, executionNet: number, executionGross: number, depth: number): void {
  if (executionGross <= 0) return;

  const shockRatio = clamp(executionGross / depth, 0, 3);
  const signedShock = clamp(executionNet / depth, -3, 3);
  stock.heat = clamp(stock.heat + shockRatio * 1.1, 0, GAME_CONFIG.maxStockHeat);
  stock.attention = clamp(stock.attention + shockRatio * 1.45, 0, 100);
  stock.sentiment = clamp(stock.sentiment + signedShock * 0.9, 0, 100);

  if (signedShock > 0) {
    stock.retail.greed = clamp(stock.retail.greed + signedShock * 1.2, 0, 100);
    stock.retail.boardFaith = clamp(stock.retail.boardFaith + signedShock * 0.8, 0, 100);
  } else if (signedShock < 0) {
    stock.retail.fear = clamp(stock.retail.fear + Math.abs(signedShock) * 1.25, 0, 100);
    stock.retail.panicSellers = clamp(stock.retail.panicSellers + Math.abs(signedShock) * 0.9, 0, 100);
  }
}

function updateLastPrintSign(state: MicrostructureState, priceMove: number): void {
  state.lastPrintSign = signOrZero(priceMove);
}

function signOrZero(value: number): -1 | 0 | 1 {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

function getBoardAdjustedImbalance(stock: Stock, pressure: Pressure, upperLimit: number, lowerLimit: number): number {
  if (stock.price >= upperLimit && pressure.imbalance < 0 && stock.buyQueue > 0) {
    const sellExcess = Math.max(0, pressure.sellPressure - pressure.buyPressure);
    const queueBuffer = stock.buyQueue * (stock.boardState === "sealedLimitUp" ? 0.62 : 0.42);
    return sellExcess <= queueBuffer ? 0 : -(sellExcess - queueBuffer);
  }

  if (stock.price <= lowerLimit && pressure.imbalance > 0 && stock.sellQueue > 0) {
    const buyExcess = Math.max(0, pressure.buyPressure - pressure.sellPressure);
    const queueResistance = stock.sellQueue * (stock.boardState === "limitDown" ? 0.58 : 0.38);
    return buyExcess <= queueResistance ? 0 : buyExcess - queueResistance;
  }

  return pressure.imbalance;
}

function getBoardAdjustedExecutionNet(stock: Stock, executionNet: number, upperLimit: number, lowerLimit: number): number {
  if (stock.price >= upperLimit && executionNet < 0 && stock.buyQueue > 0) {
    const absorbed = stock.buyQueue * (stock.boardState === "sealedLimitUp" ? 0.78 : 0.52);
    return Math.abs(executionNet) <= absorbed ? 0 : -(Math.abs(executionNet) - absorbed);
  }

  if (stock.price <= lowerLimit && executionNet > 0 && stock.sellQueue > 0) {
    const absorbed = stock.sellQueue * (stock.boardState === "limitDown" ? 0.72 : 0.48);
    return executionNet <= absorbed ? 0 : executionNet - absorbed;
  }

  return executionNet;
}

function enforceQueuePin(
  stock: Stock,
  pressure: Pressure,
  rawExecutionNet: number,
  printTicks: number,
  upperLimit: number,
  lowerLimit: number
): number {
  if (stock.price >= upperLimit && stock.buyQueue > 0 && printTicks < 0) {
    const sellLoad = pressure.sellPressure + Math.max(0, -rawExecutionNet);
    const buyBuffer = pressure.buyPressure + stock.buyQueue * (stock.boardState === "sealedLimitUp" ? 0.72 : 0.48);
    return sellLoad <= buyBuffer ? 0 : printTicks;
  }

  if (stock.price <= lowerLimit && stock.sellQueue > 0 && printTicks > 0) {
    const buyLoad = pressure.buyPressure + Math.max(0, rawExecutionNet);
    const sellBuffer = pressure.sellPressure + stock.sellQueue * (stock.boardState === "limitDown" ? 0.66 : 0.44);
    return buyLoad <= sellBuffer ? 0 : printTicks;
  }

  return printTicks;
}

export function updateStockDerivedMetrics(stock: Stock): void {
  const timeScale = GAME_CONFIG.tickDurationSeconds / BASELINE_TICK_SECONDS;
  const activeTape = clamp(
    (stock.microstructure.liquidityStress + Math.abs(stock.microstructure.flowMemory) * 0.45) / 90 +
      Math.min(1, stock.turnover / Math.max(1, stock.currentLiquidity) / 16),
    0.22,
    1
  );
  const heatFatigue = stock.heat > 65 ? 0.55 : 1;
  const extremeMove = Math.max(0, Math.abs(stock.momentum) - 45) * activeTape * heatFatigue;
  const heatDecay =
    stock.boardState === "loose"
      ? 0.16
      : stock.boardState === "attackingLimitUp" || stock.boardState === "weakSeal"
        ? 0.08
        : stock.boardState === "sealedLimitUp" || stock.boardState === "panic"
          ? 0.055
          : 0.045;

  stock.attention = clamp(
    stock.attention + ((35 - stock.attention) * 0.008 + Math.abs(stock.momentum) * 0.018) * timeScale,
    0,
    100
  );
  stock.sentiment = clamp(stock.sentiment + ((50 - stock.sentiment) * 0.006 + stock.momentum * 0.006) * timeScale, 0, 100);
  stock.heat = clamp(stock.heat + (extremeMove * 0.0045 - heatDecay) * timeScale, 0, 100);
}

function updatePriceDerivedFields(stock: Stock): void {
  stock.high = Math.max(stock.high, stock.price);
  stock.low = Math.min(stock.low, stock.price);
  stock.momentum = clamp((stock.price / stock.previousClose - 1) * 1000, -100, 100);
  updateValuationFromPrice(stock);
}
