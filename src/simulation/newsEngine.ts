import { clamp, GAME_CONFIG } from "../game/config";
import type { GameState, Stock } from "../game/types";
import { MARKET_BEHAVIOR_CONFIG } from "./marketBehaviorConfig";

export type NewsPressure = {
  impact: number;
  buyPressure: number;
  sellPressure: number;
};

export function calculateNewsPressure(game: GameState, stock: Stock): NewsPressure {
  const impact = game.news
    .filter((news) => news.scope === "market" || news.targetId === stock.sector || news.targetId === stock.id)
    .reduce((total, news) => total + news.polarity * news.strength * (news.credibility / 100), 0);

  return {
    impact,
    buyPressure: Math.max(0, impact) * MARKET_BEHAVIOR_CONFIG.news.pressurePerImpactPoint,
    sellPressure: Math.max(0, -impact) * MARKET_BEHAVIOR_CONFIG.news.pressurePerImpactPoint
  };
}

export function applyNewsActorEffects(stock: Stock, news: NewsPressure): void {
  if (news.impact === 0) return;

  const config = MARKET_BEHAVIOR_CONFIG.news.actorEffects;
  const positiveImpact = Math.max(0, news.impact);
  const negativeImpact = Math.max(0, -news.impact);
  const absoluteImpact = Math.abs(news.impact);

  stock.attention = clamp(stock.attention + absoluteImpact * config.attentionPerAbsImpact, 0, 100);
  stock.heat = clamp(stock.heat + absoluteImpact * config.heatPerAbsImpact, 0, GAME_CONFIG.maxStockHeat);
  stock.sentiment = clamp(stock.sentiment + news.impact * config.sentimentPerImpact, 0, 100);
  stock.retail.attention = clamp(stock.retail.attention + absoluteImpact * config.retailAttentionPerAbsImpact, 0, 100);
  stock.retail.newsFollowers = clamp(stock.retail.newsFollowers + absoluteImpact * config.newsFollowersPerAbsImpact, 0, 100);

  if (positiveImpact > 0) {
    stock.retail.greed = clamp(stock.retail.greed + positiveImpact * config.greedPerPositiveImpact, 0, 100);
    stock.retail.boardFaith = clamp(stock.retail.boardFaith + positiveImpact * config.boardFaithPerPositiveImpact, 0, 100);
  }

  if (negativeImpact > 0) {
    stock.retail.fear = clamp(stock.retail.fear + negativeImpact * config.fearPerNegativeImpact, 0, 100);
    stock.retail.panicSellers = clamp(stock.retail.panicSellers + negativeImpact * config.panicSellersPerNegativeImpact, 0, 100);
    stock.retail.dipBuyers = clamp(stock.retail.dipBuyers + negativeImpact * config.dipBuyersPerNegativeImpact, 0, 100);
  }
}
