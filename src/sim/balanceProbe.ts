import { createInitialGame } from "../game/createInitialGame";
import { GAME_CONFIG } from "../game/config";
import type { BoardState, GameState, StockId, TickResult } from "../game/types";
import { updateTick } from "../simulation/tick";
import { moneyShort, pad } from "./format";

type ProbeSummary = {
  seed: string;
  days: number;
  ticks: number;
  minReturnPct: number;
  maxReturnPct: number;
  panicTicks: number;
  limitUpTicks: number;
  limitDownTicks: number;
  playerNetWorth: number;
  whalePnl: number;
  whaleTrades: number;
  fundamentalDigests: number;
  stockRows: StockProbeRow[];
  whaleRows: WhaleProbeRow[];
};

type StockProbeRow = {
  stockId: StockId;
  returnPct: number;
  panicTicks: number;
  limitUpTicks: number;
  limitDownTicks: number;
  pe: number;
  fairPe: number;
};

type WhaleProbeRow = {
  name: string;
  pnl: number;
  netWorth: number;
  cash: number;
};

const seedArg = process.argv[2];
const dayArg = Number.parseInt(process.argv[3] ?? "", 10);
const seeds = seedArg ? seedArg.split(",").map((seed) => seed.trim()).filter(Boolean) : buildDefaultSeeds();
const days = Number.isFinite(dayArg) && dayArg > 0 ? Math.min(dayArg, GAME_CONFIG.totalDays) : 10;

const summaries = seeds.map((seed) => runProbe(seed, days));
printSummaries(summaries);
printAverages(summaries);
printWorstStocks(summaries);
printWhalePnl(summaries);

function runProbe(seed: string, targetDays: number): ProbeSummary {
  const game = createInitialGame(seed);
  const initialPrices = Object.fromEntries(Object.values(game.stocks).map((stock) => [stock.id, stock.price])) as Record<
    StockId,
    number
  >;
  let ticks = 0;
  let panicTicks = 0;
  let limitUpTicks = 0;
  let limitDownTicks = 0;
  let whaleTrades = 0;
  const stockCounters = Object.fromEntries(
    Object.keys(game.stocks).map((stockId) => [stockId, { panicTicks: 0, limitUpTicks: 0, limitDownTicks: 0 }])
  ) as Record<StockId, { panicTicks: number; limitUpTicks: number; limitDownTicks: number }>;

  while (game.phase !== "ended" && (game.day < targetDays || game.phase !== "preMarket" || game.tick !== 0)) {
    const result = updateTick(game);
    ticks += 1;
    whaleTrades += result.whaleTrades.length;
    const boardCounts = countBoardStates(result);
    panicTicks += boardCounts.panic + boardCounts.brokenBoard;
    limitUpTicks += boardCounts.sealedLimitUp + boardCounts.weakSeal + boardCounts.attackingLimitUp;
    limitDownTicks += boardCounts.limitDown;
    for (const stock of result.stocks) {
      const counter = stockCounters[stock.stockId];
      if (stock.boardState === "panic" || stock.boardState === "brokenBoard") counter.panicTicks += 1;
      if (stock.boardState === "sealedLimitUp" || stock.boardState === "weakSeal" || stock.boardState === "attackingLimitUp") {
        counter.limitUpTicks += 1;
      }
      if (stock.boardState === "limitDown") counter.limitDownTicks += 1;
    }

    if (game.day >= targetDays + 1 && game.phase === "preMarket" && game.tick === 0) break;
  }

  const returns = Object.values(game.stocks).map((stock) => (stock.price / initialPrices[stock.id] - 1) * 100);
  const whalePnl = game.whales.reduce((total, whale) => total + whale.realizedPnl + whale.unrealizedPnl, 0);
  const stockRows = Object.values(game.stocks).map((stock) => ({
    stockId: stock.id,
    returnPct: (stock.price / initialPrices[stock.id] - 1) * 100,
    panicTicks: stockCounters[stock.id].panicTicks,
    limitUpTicks: stockCounters[stock.id].limitUpTicks,
    limitDownTicks: stockCounters[stock.id].limitDownTicks,
    pe: stock.pe,
    fairPe: stock.fairPe
  }));
  const whaleRows = game.whales.map((whale) => ({
    name: whale.name,
    pnl: whale.realizedPnl + whale.unrealizedPnl,
    netWorth: whale.netWorth,
    cash: whale.cash
  }));

  return {
    seed,
    days: game.day,
    ticks,
    minReturnPct: Math.min(...returns),
    maxReturnPct: Math.max(...returns),
    panicTicks,
    limitUpTicks,
    limitDownTicks,
    playerNetWorth: game.player.netWorth,
    whalePnl,
    whaleTrades,
    fundamentalDigests: game.eventLog.filter((event) => event.type === "fundamentalDigest").length,
    stockRows,
    whaleRows
  };
}

function countBoardStates(result: TickResult): Record<BoardState, number> {
  const counts: Record<BoardState, number> = {
    loose: 0,
    attackingLimitUp: 0,
    sealedLimitUp: 0,
    weakSeal: 0,
    brokenBoard: 0,
    panic: 0,
    limitDown: 0
  };

  for (const stock of result.stocks) {
    counts[stock.boardState] += 1;
  }

  return counts;
}

function printSummaries(summaries: ProbeSummary[]): void {
  console.log(`Whale-Sim balance probe`);
  console.log(`Seeds=${summaries.length} targetDays=${days}`);
  console.log("");
  console.log(
    [
      pad("Seed", 20),
      pad("Ticks", 6),
      pad("Min%", 8),
      pad("Max%", 8),
      pad("Panic", 7),
      pad("UpBd", 7),
      pad("DnBd", 7),
      pad("WTrades", 8),
      pad("WPnL", 10),
      pad("Digest", 7)
    ].join(" ")
  );

  for (const summary of summaries) {
    console.log(
      [
        pad(summary.seed, 20),
        pad(summary.ticks.toString(), 6),
        pad(summary.minReturnPct.toFixed(1), 8),
        pad(summary.maxReturnPct.toFixed(1), 8),
        pad(summary.panicTicks.toString(), 7),
        pad(summary.limitUpTicks.toString(), 7),
        pad(summary.limitDownTicks.toString(), 7),
        pad(summary.whaleTrades.toString(), 8),
        pad(moneyShort(summary.whalePnl), 10),
        pad(summary.fundamentalDigests.toString(), 7)
      ].join(" ")
    );
  }
}

function printAverages(summaries: ProbeSummary[]): void {
  const divisor = Math.max(1, summaries.length);
  const avg = {
    minReturnPct: sum(summaries, "minReturnPct") / divisor,
    maxReturnPct: sum(summaries, "maxReturnPct") / divisor,
    panicTicks: sum(summaries, "panicTicks") / divisor,
    limitUpTicks: sum(summaries, "limitUpTicks") / divisor,
    limitDownTicks: sum(summaries, "limitDownTicks") / divisor,
    whaleTrades: sum(summaries, "whaleTrades") / divisor,
    whalePnl: sum(summaries, "whalePnl") / divisor,
    playerNetWorth: sum(summaries, "playerNetWorth") / divisor
  };

  console.log("");
  console.log(
    `Average: min=${avg.minReturnPct.toFixed(1)}% max=${avg.maxReturnPct.toFixed(1)}% ` +
      `panicTicks=${avg.panicTicks.toFixed(1)} upBoardTicks=${avg.limitUpTicks.toFixed(1)} ` +
      `downBoardTicks=${avg.limitDownTicks.toFixed(1)} whaleTrades=${avg.whaleTrades.toFixed(1)} ` +
      `whalePnL=${moneyShort(avg.whalePnl)} playerNet=${moneyShort(avg.playerNetWorth)}`
  );
}

function printWorstStocks(summaries: ProbeSummary[]): void {
  const rows = summaries
    .flatMap((summary) => summary.stockRows.map((row) => ({ ...row, seed: summary.seed })))
    .sort((a, b) => a.returnPct - b.returnPct)
    .slice(0, 8);

  console.log("");
  console.log("Worst stock paths");
  console.log(
    [pad("Seed", 14), pad("Stock", 18), pad("Ret%", 8), pad("Panic", 7), pad("UpBd", 7), pad("DnBd", 7), pad("PE/Fair", 12)].join(
      " "
    )
  );
  for (const row of rows) {
    console.log(
      [
        pad(row.seed, 14),
        pad(row.stockId, 18),
        pad(row.returnPct.toFixed(1), 8),
        pad(row.panicTicks.toString(), 7),
        pad(row.limitUpTicks.toString(), 7),
        pad(row.limitDownTicks.toString(), 7),
        pad(`${row.pe.toFixed(1)}/${row.fairPe.toFixed(1)}`, 12)
      ].join(" ")
    );
  }
}

function printWhalePnl(summaries: ProbeSummary[]): void {
  const pnlByWhale = new Map<string, { pnl: number; netWorth: number; cash: number; count: number }>();

  for (const summary of summaries) {
    for (const whale of summary.whaleRows) {
      const row = pnlByWhale.get(whale.name) ?? { pnl: 0, netWorth: 0, cash: 0, count: 0 };
      row.pnl += whale.pnl;
      row.netWorth += whale.netWorth;
      row.cash += whale.cash;
      row.count += 1;
      pnlByWhale.set(whale.name, row);
    }
  }

  console.log("");
  console.log("Average whale marks");
  console.log([pad("Whale", 24), pad("PnL", 10), pad("Net", 10), pad("Cash", 10)].join(" "));
  for (const [name, row] of [...pnlByWhale.entries()].sort((a, b) => a[1].pnl - b[1].pnl)) {
    console.log(
      [
        pad(name, 24),
        pad(moneyShort(row.pnl / row.count), 10),
        pad(moneyShort(row.netWorth / row.count), 10),
        pad(moneyShort(row.cash / row.count), 10)
      ].join(" ")
    );
  }
}

function sum(summaries: ProbeSummary[], key: keyof ProbeSummary): number {
  return summaries.reduce((total, summary) => total + Number(summary[key]), 0);
}

function buildDefaultSeeds(): string[] {
  return Array.from({ length: 8 }, (_, index) => `balance-${index + 1}`);
}
