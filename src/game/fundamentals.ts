import { clamp, roundMoney } from "./config";
import type { BoardType, SectorId, Stock } from "./types";

export type ValuationSnapshot = {
  fairValue: number;
  valuationGap: number;
  profitYield: number;
  qualityScore: number;
  overvalued: boolean;
  undervalued: boolean;
};

const sectorFairPe: Record<SectorId, number> = {
  tech: 42,
  biotech: 46,
  property: 8,
  consumer: 28,
  resources: 22,
  finance: 7,
  defense: 34,
  energy: 15
};

const sectorGrowthBase: Record<SectorId, number> = {
  tech: 16,
  biotech: 20,
  property: -6,
  consumer: 7,
  resources: 5,
  finance: 3,
  defense: 11,
  energy: 4
};

const sectorGrowthPeWeight: Record<SectorId, number> = {
  tech: 0.42,
  biotech: 0.42,
  property: 0.16,
  consumer: 0.28,
  resources: 0.3,
  finance: 0.16,
  defense: 0.36,
  energy: 0.22
};

export function deriveProfitGrowth(sector: SectorId, financialHealth: number): number {
  return roundMoney(clamp(sectorGrowthBase[sector] + (financialHealth - 50) * 0.22, -18, 32));
}

export function calculateFairPe(
  sector: SectorId,
  boardType: BoardType,
  financialHealth: number,
  profitGrowth: number
): number {
  const boardPremium = boardType === "growth" ? 1.12 : boardType === "st" ? 0.68 : 1;
  const healthPremium = (financialHealth - 50) * 0.08;
  const growthPremium = profitGrowth * sectorGrowthPeWeight[sector];
  return roundMoney(clamp((sectorFairPe[sector] + healthPremium + growthPremium) * boardPremium, 4, 82));
}

export function deriveInitialFundamentals(
  stock: Omit<
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
  >
): Pick<Stock, "sharesOutstanding" | "fairPe" | "earningsPerShare" | "netProfit" | "profitGrowth"> {
  const sharesOutstanding = stock.price > 0 ? stock.marketCap / stock.price : stock.floatShares;
  const earningsPerShare = stock.pe > 0 ? stock.price / stock.pe : 0.01;
  const netProfit = earningsPerShare * sharesOutstanding;
  const profitGrowth = deriveProfitGrowth(stock.sector, stock.financialHealth);
  const fairPe = calculateFairPe(stock.sector, stock.boardType, stock.financialHealth, profitGrowth);

  return {
    sharesOutstanding: roundMoney(sharesOutstanding),
    fairPe,
    earningsPerShare: roundMoney(earningsPerShare),
    netProfit: roundMoney(netProfit),
    profitGrowth
  };
}

export function updateValuationFromPrice(stock: Stock): void {
  if (stock.earningsPerShare > 0) {
    stock.pe = roundMoney(stock.price / stock.earningsPerShare);
  }

  if (stock.sharesOutstanding > 0) {
    stock.marketCap = roundMoney(stock.sharesOutstanding * stock.price);
    stock.netProfit = roundMoney(stock.earningsPerShare * stock.sharesOutstanding);
  }
}

export function getValuationSnapshot(stock: Stock): ValuationSnapshot {
  const fairPe = stock.fairPe > 0 ? stock.fairPe : calculateFairPe(stock.sector, stock.boardType, stock.financialHealth, stock.profitGrowth);
  const fairValue = Math.max(0.01, stock.earningsPerShare * fairPe);
  const valuationGap = stock.price / fairValue - 1;
  const profitYield = stock.pe > 0 ? 100 / stock.pe : 0;
  const qualityScore = clamp((stock.financialHealth - 50) / 50, -1, 1);

  return {
    fairValue: roundMoney(fairValue),
    valuationGap,
    profitYield,
    qualityScore,
    overvalued: valuationGap > 0.32,
    undervalued: valuationGap < -0.18
  };
}
