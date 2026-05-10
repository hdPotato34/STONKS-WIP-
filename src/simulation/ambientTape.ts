import { clamp, GAME_CONFIG, roundMoney, roundShares } from "../game/config";
import { createRng } from "../game/rng";
import type { GameState, Pressure, Stock } from "../game/types";
import { getMarketCapClass } from "./marketDepth";

const BASELINE_TICK_SECONDS = 5;

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
  const capFactor = capClass === "large" ? 1.16 : capClass === "mid" ? 1 : 0.82;
  const attentionFactor = 0.55 + stock.attention / 130;
  const institutionFactor = 0.75 + stock.institutionPresence / 180;
  const volatilityFactor = 0.75 + game.market.volatility / 150;
  const passiveFlow = stock.currentLiquidity * 0.0024 * capFactor * attentionFactor * institutionFactor * volatilityFactor;
  const matchedStrategyFlow = Math.min(buyNotional, sellNotional) * 0.18;
  const aggressiveCrossFlow = Math.abs(buyNotional - sellNotional) * 0.026;
  const timeScale = GAME_CONFIG.tickDurationSeconds / BASELINE_TICK_SECONDS;
  const rng = createRng(`${game.rngSeed}:ambient-tape:${game.day}:${game.tick}:${stock.id}`);
  const churn = rng.float(0.72, 1.28);
  const cap = stock.currentLiquidity * (capClass === "large" ? 0.06 : capClass === "mid" ? 0.075 : 0.095) * timeScale;
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
