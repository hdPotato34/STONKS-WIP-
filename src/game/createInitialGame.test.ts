import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "./config";
import { createInitialGame } from "./createInitialGame";

describe("createInitialGame", () => {
  it("creates the required starting market", () => {
    const game = createInitialGame("initial-state-test");

    expect(GAME_CONFIG.tickDurationSeconds).toBe(1);
    expect(GAME_CONFIG.ticksPerDay).toBe(300);
    expect(GAME_CONFIG.startingCash).toBe(1_000_000_000);
    expect(game.day).toBe(1);
    expect(game.tick).toBe(0);
    expect(game.phase).toBe("preMarket");
    expect(game.player.cash).toBe(GAME_CONFIG.startingCash);
    expect(Object.keys(game.stocks)).toHaveLength(GAME_CONFIG.stockCount);
    expect(game.whales.length).toBeGreaterThanOrEqual(5);
    expect(game.news.length).toBeGreaterThan(0);
  });

  it("uses fictional stocks with initialized charts and board states", () => {
    const game = createInitialGame("stock-test");

    for (const stock of Object.values(game.stocks)) {
      expect(stock.name).not.toMatch(/贵州|茅台|腾讯|阿里|宁德|招商|平安/i);
      expect(stock.price).toBeGreaterThan(0);
      expect(stock.previousClose).toBe(stock.price);
      expect(stock.chart).toHaveLength(1);
      expect(stock.dailyCandles.length).toBeGreaterThan(10);
      expect(stock.dailyCandles[0]?.volume).toBeGreaterThan(0);
      expect(stock.dailyCandles[0]?.turnover).toBeGreaterThan(0);
      expect(stock.dailyCandles.at(-1)?.day).toBe(1);
      expect(stock.boardState).toBe("loose");
    }
  });

  it("builds mixed initial daily candles ending at the live previous close", () => {
    const game = createInitialGame("mixed-history-test");

    for (const stock of Object.values(game.stocks)) {
      const historical = stock.dailyCandles.filter((candle) => candle.day < 1);
      const returns = historical.map((candle) => (candle.close / candle.open - 1) * 100);

      expect(historical.at(-1)?.close).toBe(stock.previousClose);
      expect(returns.some((value) => value > 0.15)).toBe(true);
      expect(returns.some((value) => value < -0.15)).toBe(true);
      expect(Math.max(...returns)).toBeLessThan(9);
      expect(Math.min(...returns)).toBeGreaterThan(-9);
    }
  });
});
