import type { GameState, Stock } from "../game/types";

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
    buyPressure: Math.max(0, impact) * 28_000,
    sellPressure: Math.max(0, -impact) * 28_000
  };
}
