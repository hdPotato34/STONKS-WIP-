import { GAME_CONFIG } from "./config";
import type { GameState, NewsItem } from "./types";
import { createStocks } from "../content/stocks";
import { sectors } from "../content/sectors";
import { createWhales } from "../content/whales";

const openingNews: NewsItem[] = [
  {
    id: "NEWS_DAY1_POLICY_TECH",
    title: "Policy desks hint at more software procurement support",
    source: "policy",
    scope: "sector",
    targetId: "tech",
    polarity: 1,
    strength: 54,
    credibility: 58,
    durationDays: 2,
    remainingDays: 2,
    tags: ["policy", "software", "attention"],
    heatImpact: 4
  },
  {
    id: "NEWS_DAY1_PROPERTY_PRESSURE",
    title: "Several regional property lenders tighten developer credit lines",
    source: "market",
    scope: "sector",
    targetId: "property",
    polarity: -1,
    strength: 46,
    credibility: 70,
    durationDays: 2,
    remainingDays: 2,
    tags: ["credit", "fear", "property"],
    heatImpact: 2
  }
];

export function createInitialGame(seed = "whale-sim-default"): GameState {
  const stocks = createStocks();

  return {
    day: 1,
    tick: 0,
    phase: "preMarket",
    rngSeed: seed,
    market: {
      regime: "choppy",
      sentiment: 52,
      liquidity: 58,
      volatility: 48,
      regulatorStrictness: 42
    },
    sectors: structuredClone(sectors),
    stocks,
    player: {
      cash: GAME_CONFIG.startingCash,
      netWorth: GAME_CONFIG.startingCash,
      realizedPnl: 0,
      unrealizedPnl: 0,
      influence: 50,
      reputation: 50,
      accountHeat: 0,
      positions: {},
      activeOrders: [],
      bearContracts: []
    },
    news: structuredClone(openingNews),
    whales: createWhales(stocks),
    regulator: {
      strictness: 42,
      events: []
    },
    eventLog: [
      {
        day: 1,
        tick: 0,
        type: "runStarted",
        message: `Run started with seed ${seed}.`
      }
    ]
  };
}
