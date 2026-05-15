import { clamp, roundMoney } from "../game/config";
import type { ShrimpCohort, ShrimpStrategy, Stock } from "../game/types";
import marketBehavior from "../config/marketBehavior.json";
import shrimpCohortConstitution from "../config/shrimpCohortConstitution.json";

type StockForShrimp = Omit<
  Stock,
  | "chart"
  | "dailyCandles"
  | "microPrice"
  | "microstructure"
  | "shrimpCohorts"
  | "options"
  | "boardQueueLedger"
  | "sharesOutstanding"
  | "fairPe"
  | "earningsPerShare"
  | "netProfit"
  | "profitGrowth"
>;

type CohortSeed = {
  strategy: ShrimpStrategy;
  weight: number;
  conviction: number;
  activity: number;
  riskAppetite: number;
  orderSize: number;
  inventoryRatio: number;
};

export function createInitialShrimpCohorts(stock: StockForShrimp): ShrimpCohort[] {
  const tilts = Object.fromEntries(Object.keys(shrimpCohortConstitution.tilts).map((tilt) => [tilt, calculateTilt(stock, tilt)]));
  const capClass = getConstitutionCapClass(stock);
  const capitalBaseConfig = shrimpCohortConstitution.capitalBase;
  const capitalBase =
    stock.baseLiquidity *
    (capitalBaseConfig.base +
      stock.attention / capitalBaseConfig.attentionScale +
      stock.retail.attention / capitalBaseConfig.retailAttentionScale +
      stock.retail.bagholders / capitalBaseConfig.bagholderScale) *
    shrimpCohortConstitution.capBoosts.capitalBase[capClass];

  const seeds = Object.entries(shrimpCohortConstitution.strategies).map(([strategy, config]) =>
    buildCohortSeed(stock, strategy as ShrimpStrategy, config, tilts, capClass)
  );

  const totalWeight = seeds.reduce((total, seed) => total + seed.weight, 0);
  return seeds.map((seed) => {
    const capital = roundMoney((capitalBase * seed.weight) / Math.max(shrimpCohortConstitution.capitalWeightFloor, totalWeight));
    return {
      strategy: seed.strategy,
      capital,
      inventoryNotional: roundMoney(capital * clamp(seed.inventoryRatio, shrimpCohortConstitution.inventoryRatioMin, shrimpCohortConstitution.inventoryRatioMax)),
      conviction: clamp(seed.conviction, 0, 100),
      activity: clamp(seed.activity, 0, 100),
      riskAppetite: clamp(seed.riskAppetite, 0, 100),
      orderSize: Math.max(shrimpCohortConstitution.minOrderSize, Math.round(seed.orderSize)),
      flowMemory: 0
    };
  });
}

function buildCohortSeed(
  stock: StockForShrimp,
  strategy: ShrimpStrategy,
  config: (typeof shrimpCohortConstitution.strategies)[keyof typeof shrimpCohortConstitution.strategies],
  tilts: Record<string, number>,
  capClass: keyof typeof shrimpCohortConstitution.capBoosts.capitalBase
): CohortSeed {
  return {
    strategy,
    weight: calculateFormula(stock, config.weight, tilts) * getCapBoost("capBoost" in config.weight ? config.weight.capBoost : undefined, capClass),
    conviction: calculateFormula(stock, config.conviction, tilts),
    activity: calculateFormula(stock, config.activity, tilts),
    riskAppetite: calculateFormula(stock, config.riskAppetite, tilts),
    orderSize: stock.price < config.orderSize.priceThreshold ? config.orderSize.below : config.orderSize.default,
    inventoryRatio: calculateFormula(stock, config.inventoryRatio, tilts)
  };
}

function calculateTilt(stock: StockForShrimp, tiltName: string): number {
  const tilt = shrimpCohortConstitution.tilts[tiltName as keyof typeof shrimpCohortConstitution.tilts];
  return clamp((calculateFeatureSum(stock, tilt.features) - tilt.offset) / tilt.scale, 0, 1);
}

function calculateFormula(
  stock: StockForShrimp,
  formula: { base: number; tilt?: string; tiltWeight?: number; features?: Record<string, number> },
  tilts: Record<string, number>
): number {
  return formula.base + (formula.tilt ? (tilts[formula.tilt] ?? 0) * (formula.tiltWeight ?? 0) : 0) + calculateFeatureSum(stock, formula.features ?? {});
}

function calculateFeatureSum(stock: StockForShrimp, features: Record<string, number>): number {
  return Object.entries(features).reduce((total, [feature, weight]) => total + getFeatureValue(stock, feature) * weight, 0);
}

function getFeatureValue(stock: StockForShrimp, feature: string): number {
  switch (feature) {
    case "attention":
      return stock.attention;
    case "absMomentum":
      return Math.abs(stock.momentum);
    case "positiveMomentum":
      return Math.max(0, stock.momentum);
    case "financialHealth":
      return stock.financialHealth;
    case "institutionPresence":
      return stock.institutionPresence;
    case "quantPresence":
      return stock.quantPresence;
    case "peDiscount16":
      return Math.max(0, 16 - stock.pe);
    case "peDiscount18":
      return Math.max(0, 18 - stock.pe);
    case "inverseRetailFear":
      return 100 - stock.retail.fear;
    case "retail.attention":
      return stock.retail.attention;
    case "retail.bagholders":
      return stock.retail.bagholders;
    case "retail.boardFaith":
      return stock.retail.boardFaith;
    case "retail.dipBuyers":
      return stock.retail.dipBuyers;
    case "retail.fear":
      return stock.retail.fear;
    case "retail.gamblers":
      return stock.retail.gamblers;
    case "retail.greed":
      return stock.retail.greed;
    case "retail.momentum":
      return stock.retail.momentum;
    case "retail.panicSellers":
      return stock.retail.panicSellers;
    case "cost.deepLoss":
      return stock.costDistribution.deepLoss;
    case "cost.loss":
      return stock.costDistribution.loss;
    default:
      return 0;
  }
}

function getConstitutionCapClass(stock: StockForShrimp): "small" | "mid" | "large" {
  if (stock.marketCap < marketBehavior.marketCap.smallMax) return "small";
  if (stock.marketCap <= marketBehavior.marketCap.midMax) return "mid";
  return "large";
}

function getCapBoost(boostName: string | undefined, capClass: "small" | "mid" | "large"): number {
  if (!boostName) return 1;
  return shrimpCohortConstitution.capBoosts[boostName as keyof typeof shrimpCohortConstitution.capBoosts][capClass];
}
