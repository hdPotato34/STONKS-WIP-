import type { GameState, Stock } from "../game/types";
import { createRng } from "../game/rng";
import { getValuationSnapshot } from "../game/fundamentals";
import { getMarketMemory } from "./marketMemory";

export type QuantPressure = {
  signal: number;
  buyPressure: number;
  sellPressure: number;
};

export function calculateQuantPressure(
  game: GameState,
  stock: Stock,
  newsImpact: number,
  playerVisibility: number
): QuantPressure {
  const weakBoardSignal = stock.boardState === "weakSeal" || stock.boardState === "brokenBoard" ? 1 : 0;
  const valuation = getValuationSnapshot(stock);
  const memory = getMarketMemory(game, stock);
  const overextension = Math.max(0, valuation.valuationGap);
  const undervaluation = Math.max(0, -valuation.valuationGap);
  const washout = stock.boardState === "panic" || stock.boardState === "limitDown" || stock.momentum < -55;
  const staircaseRisk = Math.max(0, memory.return5d - 12) * 0.72 + Math.max(0, memory.upStreak - 3) * 4.8 + Math.max(0, memory.ma5Deviation - 7) * 0.9;
  const stopLossRisk =
    Math.max(0, -memory.return3d - 5) * 0.9 +
    Math.max(0, memory.downStreak - 1) * 4.2 +
    (memory.lastTickMovePct < -0.38 ? 8 : 0) +
    memory.boardBreaks5d * 4;
  const absorptionSignal =
    memory.drawdownFrom10dHigh < -10 && stock.financialHealth > 52 && stock.microstructure.flowMemory > 6 ? 8 : 0;
  const signal =
    stock.momentum * 0.042 +
    newsImpact * 0.04 +
    undervaluation * (stock.financialHealth > 48 ? 18 : 7) +
    (washout && stock.financialHealth > 52 ? 8 : 0) -
    overextension * (stock.heat > 48 ? 28 : 17) -
    staircaseRisk -
    stopLossRisk +
    absorptionSignal -
    weakBoardSignal * 18 -
    playerVisibility * 0.085;
  const magnitude = Math.abs(signal);
  const burstRng = createRng(`${game.rngSeed}:quant:${game.day}:${game.tick}:${stock.id}`);
  const burstChance = Math.min(0.52, 0.05 + stock.quantPresence / 320 + magnitude / 230);
  const active = magnitude >= 20 || weakBoardSignal > 0 || playerVisibility > 52 || burstRng.chance(burstChance);

  if (!active) {
    return {
      signal,
      buyPressure: 0,
      sellPressure: 0
    };
  }

  const burstScale = magnitude >= 20 || weakBoardSignal > 0 ? 0.72 : 0.38;

  return {
    signal,
    buyPressure: Math.max(0, signal) * stock.quantPresence * 4_600 * burstScale,
    sellPressure: Math.max(0, -signal) * stock.quantPresence * 4_600 * burstScale
  };
}
