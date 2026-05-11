import type { BoardState, DailyCandle, GameState, Stock } from "../game/types";

export type MarketMemorySnapshot = {
  return1d: number;
  return3d: number;
  return5d: number;
  return10d: number;
  upStreak: number;
  downStreak: number;
  greenDays5d: number;
  realizedVolatility5d: number;
  drawdownFrom10dHigh: number;
  ma5Deviation: number;
  limitUpDays5d: number;
  limitDownDays5d: number;
  boardBreaks5d: number;
  lastTickMovePct: number;
  openingGapPct: number;
  openToNowPct: number;
};

const hotBoardStates: BoardState[] = ["attackingLimitUp", "sealedLimitUp", "weakSeal"];
const weakBoardStates: BoardState[] = ["brokenBoard", "panic"];

export function getMarketMemory(game: GameState, stock: Stock): MarketMemorySnapshot {
  const currentClose = stock.price;
  const completedCandles = stock.dailyCandles.filter((candle) => candle.day < game.day);
  const currentCandle = getCurrentCandle(game, stock);
  const tape = [...completedCandles, currentCandle].filter((candle) => candle.close > 0);
  const closes = tape.map((candle) => candle.close);
  const recentReturns = getRecentReturns(tape, 5);
  const recent5 = tape.slice(-5);
  const recent10 = tape.slice(-10);
  const ma5 = average(recent5.map((candle) => candle.close));
  const high10 = Math.max(...recent10.map((candle) => candle.high), currentClose);
  const lastPrint = stock.chart.at(-1)?.price ?? stock.open;
  const previousPrint = stock.chart.at(-2)?.price ?? stock.open;

  return {
    return1d: percentChange(currentClose, stock.previousClose),
    return3d: getWindowReturn(closes, 3),
    return5d: getWindowReturn(closes, 5),
    return10d: getWindowReturn(closes, 10),
    upStreak: countStreak(tape, 1),
    downStreak: countStreak(tape, -1),
    greenDays5d: recent5.filter((candle) => percentChange(candle.close, candle.open) > 0.15).length,
    realizedVolatility5d: standardDeviation(recentReturns),
    drawdownFrom10dHigh: high10 > 0 ? percentChange(currentClose, high10) : 0,
    ma5Deviation: ma5 > 0 ? percentChange(currentClose, ma5) : 0,
    limitUpDays5d: recent5.filter((candle) => hotBoardStates.includes(candle.boardState)).length,
    limitDownDays5d: recent5.filter((candle) => candle.boardState === "limitDown").length,
    boardBreaks5d: recent5.filter((candle) => weakBoardStates.includes(candle.boardState)).length,
    lastTickMovePct: percentChange(lastPrint, previousPrint),
    openingGapPct: percentChange(stock.open, stock.previousClose),
    openToNowPct: percentChange(currentClose, stock.open)
  };
}

function getCurrentCandle(game: GameState, stock: Stock): DailyCandle {
  const candle = stock.dailyCandles.find((candidate) => candidate.day === game.day);
  return (
    candle ?? {
      day: game.day,
      open: stock.open,
      high: stock.high,
      low: stock.low,
      close: stock.price,
      volume: stock.volume,
      turnover: stock.turnover,
      boardState: stock.boardState
    }
  );
}

function getRecentReturns(candles: DailyCandle[], count: number): number[] {
  return candles
    .slice(-count - 1)
    .slice(1)
    .map((candle, index, recent) => {
      const previous = index === 0 ? candles.at(-recent.length - 1)?.close : recent[index - 1]?.close;
      return percentChange(candle.close, previous ?? candle.open);
    });
}

function getWindowReturn(closes: number[], days: number): number {
  if (closes.length < 2) return 0;
  const current = closes.at(-1) ?? 0;
  const base = closes[Math.max(0, closes.length - days - 1)] ?? current;
  return percentChange(current, base);
}

function countStreak(candles: DailyCandle[], direction: 1 | -1): number {
  let count = 0;
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    const candle = candles[index];
    const change = percentChange(candle.close, candle.open);
    if ((direction > 0 && change > 0.15) || (direction < 0 && change < -0.15)) {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function percentChange(current: number, previous: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return 0;
  return (current / previous - 1) * 100;
}
