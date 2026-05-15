import marketBehavior from "../config/marketBehavior.json";
import type { StockOptionProfile, Stock } from "../game/types";

type StockForOptions = Pick<
  Stock,
  "marketCap" | "baseLiquidity" | "pe" | "financialHealth" | "attention" | "heat" | "quantPresence" | "institutionPresence" | "retail" | "costDistribution"
>;

export function deriveStockOptions(stock: StockForOptions): StockOptionProfile {
  const config = marketBehavior.stockOptions;
  const marketCapClass = getMarketCapClass(stock.marketCap);
  const liquidityTier = stock.baseLiquidity > config.deepLiquidityMin ? "deep" : stock.baseLiquidity < config.thinLiquidityMax ? "thin" : "normal";
  const speculationScore =
    stock.attention +
    stock.retail.gamblers +
    stock.retail.boardFaith +
    stock.quantPresence * config.speculation.quantPresenceWeight +
    stock.heat * config.speculation.heatWeight;
  const qualityTier =
    stock.financialHealth >= config.quality.qualityMinHealth
      ? "quality"
      : stock.financialHealth < config.quality.distressedMaxHealth
        ? "distressed"
        : "ordinary";
  const valuationStyle =
    stock.pe <= config.valuation.deepValuePeMax && stock.financialHealth >= 50
      ? "deepValue"
      : stock.pe >= config.valuation.storyPeMin || (stock.pe >= config.valuation.storyPeSoftMin && speculationScore > config.valuation.storySpeculationMin)
        ? "story"
        : stock.pe >= config.valuation.expensivePeMin
          ? "expensive"
          : "fair";

  return {
    marketCapClass,
    liquidityTier,
    speculationTier:
      speculationScore >= config.speculation.highThreshold
        ? "high"
        : speculationScore >= config.speculation.mediumThreshold
          ? "medium"
          : "low",
    qualityTier,
    valuationStyle,
    behaviorTags: buildBehaviorTags(stock, marketCapClass, liquidityTier, qualityTier, valuationStyle, speculationScore)
  };
}

export function refreshStockOptions(stock: Stock): void {
  stock.options = deriveStockOptions(stock);
}

function buildBehaviorTags(
  stock: StockForOptions,
  marketCapClass: StockOptionProfile["marketCapClass"],
  liquidityTier: StockOptionProfile["liquidityTier"],
  qualityTier: StockOptionProfile["qualityTier"],
  valuationStyle: StockOptionProfile["valuationStyle"],
  speculationScore: number
): string[] {
  const tagConfig = marketBehavior.stockOptions.behaviorTags;
  const tags = new Set<string>([marketCapClass, liquidityTier, qualityTier, valuationStyle]);

  if (speculationScore >= tagConfig.storySensitiveSpeculationMin) tags.add("story-sensitive");
  if (stock.retail.bagholders + stock.costDistribution.loss + stock.costDistribution.deepLoss > tagConfig.trappedFloatMin) tags.add("trapped-float");
  if (stock.retail.dipBuyers > tagConfig.dipBidMin) tags.add("dip-bid");
  if (stock.institutionPresence > tagConfig.institutionalPresenceMin) tags.add("institutional");
  if (stock.quantPresence > tagConfig.quantActiveMin) tags.add("quant-active");
  if (stock.retail.gamblers > tagConfig.boardChaseGamblersMin || stock.retail.boardFaith > tagConfig.boardChaseFaithMin) tags.add("board-chase");
  if (stock.financialHealth < marketBehavior.stockOptions.quality.distressedMaxHealth && stock.retail.fear > tagConfig.fragileFearMin) tags.add("fragile");

  return [...tags];
}

function getMarketCapClass(marketCap: number): StockOptionProfile["marketCapClass"] {
  if (marketCap < marketBehavior.marketCap.smallMax) return "small";
  if (marketCap <= marketBehavior.marketCap.midMax) return "mid";
  return "large";
}
