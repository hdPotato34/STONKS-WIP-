import { clamp, GAME_CONFIG, roundMoney, roundShares } from "../game/config";
import { createRng } from "../game/rng";
import type { GameState, Pressure, Stock } from "../game/types";
import { MARKET_BEHAVIOR_CONFIG } from "./marketBehaviorConfig";
import { getMarketCapClass } from "./marketDepth";

const ambientConfig = MARKET_BEHAVIOR_CONFIG.ambientTape;

export type AmbientTapeTrace = {
  matchedNotional: number;
  shares: number;
  buyNotional: number;
  sellNotional: number;
};

export function executeAmbientTape(game: GameState, stock: Stock, pressure: Pressure): AmbientTapeTrace {
  if (stock.halted) {
    return {
      matchedNotional: 0,
      shares: 0,
      buyNotional: 0,
      sellNotional: 0
    };
  }

  const buyNotional =
    pressure.retailBuyPressure +
    pressure.collectiveBuyPressure +
    pressure.quantBuyPressure +
    pressure.institutionBuyPressure +
    pressure.fundamentalBuyPressure +
    pressure.newsBuyPressure +
    Math.max(0, pressure.noise);
  const sellNotional =
    pressure.retailSellPressure +
    pressure.collectiveSellPressure +
    pressure.quantSellPressure +
    pressure.institutionSellPressure +
    pressure.fundamentalSellPressure +
    pressure.newsSellPressure +
    Math.max(0, -pressure.noise);

  const capClass = getMarketCapClass(stock);
  const capFactor = ambientConfig.capFactor[capClass];
  const attentionFactor = ambientConfig.attentionBase + stock.attention / ambientConfig.attentionScale;
  const institutionFactor = ambientConfig.institutionBase + stock.institutionPresence / ambientConfig.institutionScale;
  const volatilityFactor = ambientConfig.volatilityBase + game.market.volatility / ambientConfig.volatilityScale;
  const passiveFlow = stock.currentLiquidity * ambientConfig.passiveLiquidityShare * capFactor * attentionFactor * institutionFactor * volatilityFactor;
  const matchedStrategyFlow = Math.min(buyNotional, sellNotional) * ambientConfig.matchedStrategyShare;
  const aggressiveCrossFlow = Math.abs(buyNotional - sellNotional) * ambientConfig.aggressiveCrossShare;
  const timeScale = GAME_CONFIG.tickDurationSeconds / ambientConfig.baselineTickSeconds;
  const rng = createRng(`${game.rngSeed}:ambient-tape:${game.day}:${game.tick}:${stock.id}`);
  const churn = rng.float(ambientConfig.churnMin, ambientConfig.churnMax);
  const cap = stock.currentLiquidity * ambientConfig.capLiquidityShare[capClass] * timeScale;
  const matchedNotional = roundMoney(clamp((passiveFlow + matchedStrategyFlow + aggressiveCrossFlow) * churn * timeScale, 0, cap));
  const shares = roundShares(matchedNotional / Math.max(0.01, stock.price));
  const filledNotional = roundMoney(shares * stock.price);

  if (shares > 0 && filledNotional > 0) {
    stock.volume += shares;
    stock.turnover = roundMoney(stock.turnover + filledNotional);
  }

  return {
    matchedNotional: filledNotional,
    shares,
    buyNotional,
    sellNotional
  };
}
