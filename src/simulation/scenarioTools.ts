import type { GameState, PlayerAction, StockId, StockTickTrace, TickResult } from "../game/types";
import { updateTick } from "./tick";

export function advanceToIntraday(game: GameState): TickResult[] {
  const results: TickResult[] = [];
  while (game.phase === "preMarket" || game.phase === "openingAuction") {
    results.push(updateTick(game, [], { detail: "full" }));
  }
  return results;
}

export function runScenarioTicks(game: GameState, ticks: Array<PlayerAction[] | undefined>): TickResult[] {
  return ticks.map((actions) => updateTick(game, actions ?? [], { detail: "full" }));
}

export function findStockTrace(result: TickResult, stockId: StockId): StockTickTrace {
  const trace = result.stocks.find((stock) => stock.stockId === stockId);
  if (!trace) {
    throw new Error(`No trace for ${stockId} on day ${result.day} tick ${result.tick}.`);
  }
  return trace;
}

export function formatTickTraceTable(results: TickResult[], stockId: StockId): string {
  const rows = results
    .flatMap((result) => result.stocks.map((stock) => ({ result, stock })))
    .filter(({ stock }) => stock.stockId === stockId)
    .map(({ result, stock }) => {
      const playerFill = stock.playerFills.reduce((total, fill) => total + fill.filledNotional, 0);
      const whaleFill = stock.whaleTrades.reduce((total, fill) => total + fill.filledNotional, 0);
      const resting = stock.restingOrders.reduce((total, order) => total + order.remainingCash, 0);
      const topCause = getTopCause(stock);
      return [
        `D${result.day}T${result.tick}`,
        stock.priceAfter.toFixed(2),
        stock.changePct.toFixed(2),
        stock.boardState,
        Math.round(stock.effectiveDepth).toString(),
        Math.round(playerFill).toString(),
        Math.round(resting).toString(),
        Math.round(whaleFill).toString(),
        topCause
      ].join("\t");
    });

  return ["tick\tprice\tchgPct\tboard\tdepth\tplayerFill\tresting\twhaleFill\ttopCause", ...rows].join("\n");
}

function getTopCause(stock: StockTickTrace): string {
  const cause = [...stock.heatCauses].sort((a, b) => getCauseScore(b) - getCauseScore(a))[0];
  if (!cause) return "-";

  return `${cause.source}:${cause.note.slice(0, 34)}`;
}

function getCauseScore(cause: StockTickTrace["heatCauses"][number]): number {
  return (
    Math.abs(cause.heatDelta) * 1_000_000 +
    Math.abs(cause.sentimentDelta ?? 0) * 600_000 +
    Math.abs(cause.attentionDelta ?? 0) * 400_000 +
    Math.max(cause.buyPressure ?? 0, cause.sellPressure ?? 0)
  );
}
