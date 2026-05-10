import { clamp, roundMoney } from "../game/config";
import type { ShrimpCohort, ShrimpStrategy, Stock } from "../game/types";

type StockForShrimp = Omit<
  Stock,
  | "chart"
  | "dailyCandles"
  | "microPrice"
  | "microstructure"
  | "shrimpCohorts"
  | "sharesOutstanding"
  | "fairPe"
  | "earningsPerShare"
  | "netProfit"
  | "profitGrowth"
>;

type CohortSeed = {
  strategy: ShrimpStrategy;
  weight: number;
  conviction: number;
  activity: number;
  riskAppetite: number;
  orderSize: number;
  inventoryRatio: number;
};

export function createInitialShrimpCohorts(stock: StockForShrimp): ShrimpCohort[] {
  const speculativeTilt = clamp((stock.retail.gamblers + stock.retail.boardFaith + stock.attention - 95) / 135, 0, 1);
  const valueTilt = clamp((stock.financialHealth + Math.max(0, 16 - stock.pe) * 4 + stock.institutionPresence - 95) / 145, 0, 1);
  const trappedTilt = clamp((stock.retail.bagholders + stock.retail.panicSellers + stock.costDistribution.loss - 85) / 130, 0, 1);
  const momentumTilt = clamp((stock.retail.momentum + stock.quantPresence + Math.abs(stock.momentum) - 70) / 135, 0, 1);
  const smallCapBoost = stock.marketCap < 10_000_000_000 ? 1.18 : stock.marketCap > 50_000_000_000 ? 0.72 : 1;
  const largeCapValueBoost = stock.marketCap > 50_000_000_000 ? 1.25 : 0.88;
  const capitalBase =
    stock.baseLiquidity *
    (1.8 + stock.attention / 80 + stock.retail.attention / 120 + stock.retail.bagholders / 180);

  const seeds: CohortSeed[] = [
    {
      strategy: "boardChaser",
      weight: (0.09 + speculativeTilt * 0.34) * smallCapBoost,
      conviction: 42 + stock.retail.boardFaith * 0.38 + stock.retail.greed * 0.18,
      activity: 34 + stock.attention * 0.28,
      riskAppetite: 62 + stock.retail.gamblers * 0.32,
      orderSize: stock.price < 8 ? 1_800 : 900,
      inventoryRatio: 0.22 + speculativeTilt * 0.24
    },
    {
      strategy: "momentumScalper",
      weight: 0.14 + momentumTilt * 0.24,
      conviction: 38 + stock.retail.momentum * 0.34,
      activity: 44 + stock.quantPresence * 0.24,
      riskAppetite: 48 + momentumTilt * 36,
      orderSize: stock.price < 10 ? 1_200 : 500,
      inventoryRatio: 0.18 + Math.max(0, stock.momentum) / 380
    },
    {
      strategy: "dipBuyer",
      weight: 0.14 + stock.retail.dipBuyers / 310 + valueTilt * 0.12,
      conviction: 40 + stock.retail.dipBuyers * 0.32 + stock.financialHealth * 0.12,
      activity: 30 + stock.retail.attention * 0.16,
      riskAppetite: 38 + stock.retail.dipBuyers * 0.22,
      orderSize: stock.price < 10 ? 1_500 : 600,
      inventoryRatio: 0.24 + stock.costDistribution.loss / 220
    },
    {
      strategy: "panicCutter",
      weight: 0.1 + trappedTilt * 0.3,
      conviction: 36 + stock.retail.fear * 0.24 + stock.retail.panicSellers * 0.28,
      activity: 28 + stock.retail.panicSellers * 0.28,
      riskAppetite: 18 + (100 - stock.retail.fear) * 0.22,
      orderSize: stock.price < 10 ? 1_000 : 400,
      inventoryRatio: 0.48 + stock.costDistribution.loss / 130 + stock.costDistribution.deepLoss / 120
    },
    {
      strategy: "valueHolder",
      weight: (0.11 + valueTilt * 0.36) * largeCapValueBoost,
      conviction: 46 + stock.financialHealth * 0.34 + Math.max(0, 18 - stock.pe) * 1.5,
      activity: 18 + stock.institutionPresence * 0.12,
      riskAppetite: 22 + stock.financialHealth * 0.18,
      orderSize: stock.price < 10 ? 3_000 : 1_000,
      inventoryRatio: 0.62 + valueTilt * 0.24
    },
    {
      strategy: "noiseTrader",
      weight: 0.2 + stock.attention / 440,
      conviction: 34 + stock.retail.attention * 0.16,
      activity: 52 + stock.attention * 0.18,
      riskAppetite: 42 + stock.retail.gamblers * 0.16,
      orderSize: stock.price < 10 ? 500 : 200,
      inventoryRatio: 0.26
    }
  ];

  const totalWeight = seeds.reduce((total, seed) => total + seed.weight, 0);
  return seeds.map((seed) => {
    const capital = roundMoney((capitalBase * seed.weight) / Math.max(0.01, totalWeight));
    return {
      strategy: seed.strategy,
      capital,
      inventoryNotional: roundMoney(capital * clamp(seed.inventoryRatio, 0.05, 0.92)),
      conviction: clamp(seed.conviction, 0, 100),
      activity: clamp(seed.activity, 0, 100),
      riskAppetite: clamp(seed.riskAppetite, 0, 100),
      orderSize: Math.max(100, Math.round(seed.orderSize)),
      flowMemory: 0
    };
  });
}
