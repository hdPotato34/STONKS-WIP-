import { clamp } from "../game/config";
import type { ValuationSnapshot } from "../game/fundamentals";
import type { GameState, Stock } from "../game/types";
import { MARKET_BEHAVIOR_CONFIG } from "./marketBehaviorConfig";
import { getMarketMemory } from "./marketMemory";

export type InstitutionPressure = {
  buyPressure: number;
  sellPressure: number;
};

const institutionConfig = MARKET_BEHAVIOR_CONFIG.institution;

export function calculateInstitutionPressure(game: GameState, stock: Stock, valuation: ValuationSnapshot): InstitutionPressure {
  const memory = getMarketMemory(game, stock);
  const presence = stock.institutionPresence / institutionConfig.presenceScale;
  const institutionBias = (stock.financialHealth - institutionConfig.neutralFinancialHealth) * presence;
  const overvaluation = Math.max(0, valuation.valuationGap);
  const undervaluation = Math.max(0, -valuation.valuationGap);
  const overrunSupply =
    stock.currentLiquidity *
    presence *
    (Math.max(0, overvaluation - institutionConfig.overrun.valuationThreshold) * institutionConfig.overrun.valuationWeight +
      Math.max(0, memory.return10d - institutionConfig.overrun.return10dThreshold) * institutionConfig.overrun.return10dWeight +
      Math.max(0, memory.ma5Deviation - institutionConfig.overrun.ma5DeviationThreshold) * institutionConfig.overrun.ma5DeviationWeight +
      Math.max(0, memory.openToNowPct - institutionConfig.overrun.openToNowPctThreshold) * institutionConfig.overrun.openToNowPctWeight);
  const discountSupport =
    stock.currentLiquidity *
    presence *
    Math.max(0, undervaluation - institutionConfig.discountSupport.undervaluationThreshold) *
    (stock.financialHealth > institutionConfig.discountSupport.healthyFinancialHealth
      ? institutionConfig.discountSupport.healthyWeight
      : institutionConfig.discountSupport.fragileWeight);

  return {
    buyPressure:
      Math.max(0, institutionBias) *
        institutionConfig.biasPressureUnit *
        clamp(
          1 - overvaluation * institutionConfig.overvaluationBrake.scale,
          institutionConfig.overvaluationBrake.min,
          institutionConfig.overvaluationBrake.max
        ) +
      discountSupport,
    sellPressure: Math.max(0, -institutionBias) * institutionConfig.biasPressureUnit + overrunSupply
  };
}
