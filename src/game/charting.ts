import type { DailyCandle, Stock } from "./types";

const MAX_DAILY_CANDLES = 120;

export function startDailyCandle(stock: Stock, day: number): void {
  const last = stock.dailyCandles.at(-1);
  if (last?.day === day) {
    syncDailyCandle(stock, day);
    return;
  }

  stock.dailyCandles.push(buildCandle(stock, day));
  if (stock.dailyCandles.length > MAX_DAILY_CANDLES) {
    stock.dailyCandles = stock.dailyCandles.slice(-MAX_DAILY_CANDLES);
  }
}

export function syncDailyCandle(stock: Stock, day: number): void {
  const current = stock.dailyCandles.find((candle) => candle.day === day);
  if (!current) {
    startDailyCandle(stock, day);
    return;
  }

  current.open = stock.open;
  current.high = stock.high;
  current.low = stock.low;
  current.close = stock.price;
  current.volume = stock.volume;
  current.turnover = stock.turnover;
  current.boardState = stock.boardState;
}

export function buildInitialDailyCandles(stock: Stock): DailyCandle[] {
  const historicalDays = 20;
  const candles: DailyCandle[] = [];
  const closes = Array.from({ length: historicalDays }, () => stock.previousClose);

  for (let index = historicalDays - 2; index >= 0; index -= 1) {
    const nextReturn = getHistoricalReturnPct(stock, index + 1);
    closes[index] = Math.max(0.01, closes[index + 1] / (1 + nextReturn / 100));
  }

  for (let index = 0; index < historicalDays; index += 1) {
    const day = index - historicalDays;
    const close = index === historicalDays - 1 ? stock.previousClose : closes[index];
    const open =
      index === 0
        ? Math.max(0.01, close / (1 + getHistoricalReturnPct(stock, index) / 100))
        : closes[index - 1];
    const returnPct = ((close - open) / Math.max(0.01, open)) * 100;
    const wickNoise = pseudoNoise(`${stock.id}:wick:${index}`);
    const wickBase = 0.009 + Math.abs(returnPct) / 260 + wickNoise * 0.014;
    const high = Math.max(open, close) * (1 + wickBase);
    const low = Math.min(open, close) * (1 - wickBase * (0.82 + pseudoNoise(`${stock.id}:low:${index}`) * 0.42));

    const turnoverWave = 0.65 + pseudoNoise(`${stock.id}:turnover:${index}`) * 0.82 + Math.abs(returnPct) / 18;
    const turnover = stock.baseLiquidity * turnoverWave;

    candles.push({
      day,
      open: roundCandlePrice(open),
      high: roundCandlePrice(high),
      low: roundCandlePrice(low),
      close: roundCandlePrice(close),
      volume: Math.round(turnover / Math.max(0.01, close)),
      turnover: Math.round(turnover),
      boardState: returnPct > 7.5 ? "attackingLimitUp" : returnPct < -7.5 ? "panic" : "loose"
    });
  }

  candles.push(buildCandle(stock, 1));
  return candles;
}

function buildCandle(stock: Stock, day: number): DailyCandle {
  return {
    day,
    open: stock.open,
    high: stock.high,
    low: stock.low,
    close: stock.price,
    volume: stock.volume,
    turnover: stock.turnover,
    boardState: stock.boardState
  };
}

function roundCandlePrice(value: number): number {
  return Math.round(value * 100) / 100;
}

function getHistoricalReturnPct(stock: Stock, index: number): number {
  const baseVolatility = stock.boardType === "growth" ? 3.25 : stock.marketCap < 10_000_000_000 ? 2.85 : stock.marketCap > 50_000_000_000 ? 1.55 : 2.35;
  const phase = hashToUnit(`${stock.id}:phase`) * Math.PI * 2;
  const wave = Math.sin(index * 1.37 + phase) * baseVolatility + Math.cos(index * 0.61 + phase * 0.7) * baseVolatility * 0.42;
  const shock = (hashToUnit(`${stock.id}:shock:${index}`) - 0.5) * baseVolatility * 2.1;
  const qualityDrift = (stock.sentiment - 50) * 0.018 + (stock.financialHealth - 50) * 0.012;
  const forcedRed = index % 5 === 1 ? -baseVolatility * (0.55 + hashToUnit(`${stock.id}:red:${index}`) * 0.65) : 0;
  const forcedGreen = index % 7 === 3 ? baseVolatility * (0.42 + hashToUnit(`${stock.id}:green:${index}`) * 0.5) : 0;

  return clampReturn(wave * 0.42 + shock * 0.38 + qualityDrift + forcedRed + forcedGreen);
}

function clampReturn(value: number): number {
  return Math.max(-8.8, Math.min(8.8, value));
}

function pseudoNoise(seed: string): number {
  return hashToUnit(seed);
}

function hashToUnit(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}
