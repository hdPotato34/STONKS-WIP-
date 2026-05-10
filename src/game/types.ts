export type GamePhase =
  | "preMarket"
  | "openingAuction"
  | "intraday"
  | "closingAuction"
  | "settlement"
  | "ended";

export type MarketRegime = "bull" | "bear" | "choppy";
export type BoardType = "main" | "growth" | "st";

export type BoardState =
  | "loose"
  | "attackingLimitUp"
  | "sealedLimitUp"
  | "weakSeal"
  | "brokenBoard"
  | "panic"
  | "limitDown";

export type SectorId =
  | "tech"
  | "biotech"
  | "property"
  | "consumer"
  | "resources"
  | "finance"
  | "defense"
  | "energy";

export type StockId =
  | "DRAGON_SOFT"
  | "NEW_HORIZON_BIO"
  | "GOLDEN_ROOF"
  | "PEARL_DAILY"
  | "RED_RIVER_LITHIUM"
  | "HARBOR_BANK"
  | "SKY_SHIELD"
  | "EAST_GRID_ENERGY";

export type Modifier = {
  id: string;
  label: string;
  sentimentDelta: number;
  attentionDelta: number;
  remainingDays: number;
};

export type MarketState = {
  regime: MarketRegime;
  sentiment: number;
  liquidity: number;
  volatility: number;
  regulatorStrictness: number;
};

export type SectorState = {
  id: SectorId;
  name: string;
  sentiment: number;
  attention: number;
  momentum: number;
  activeModifiers: Modifier[];
};

export type RetailProfile = {
  momentum: number;
  dipBuyers: number;
  newsFollowers: number;
  gamblers: number;
  bagholders: number;
  panicSellers: number;
  greed: number;
  fear: number;
  attention: number;
  boardFaith: number;
};

export type CostDistribution = {
  deepProfit: number;
  profit: number;
  nearCost: number;
  loss: number;
  deepLoss: number;
};

export type TickPrice = {
  day: number;
  tick: number;
  price: number;
  boardState: BoardState;
};

export type DailyCandle = {
  day: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
  boardState: BoardState;
};

export type MicrostructureState = {
  flowMemory: number;
  liquidityStress: number;
  shockMemory: number;
  lastPrintSign: -1 | 0 | 1;
};

export type ShrimpStrategy =
  | "boardChaser"
  | "momentumScalper"
  | "dipBuyer"
  | "panicCutter"
  | "valueHolder"
  | "noiseTrader";

export type ShrimpCohort = {
  strategy: ShrimpStrategy;
  capital: number;
  inventoryNotional: number;
  conviction: number;
  activity: number;
  riskAppetite: number;
  orderSize: number;
  flowMemory: number;
};

export type Stock = {
  id: StockId;
  name: string;
  sector: SectorId;
  boardType: BoardType;

  price: number;
  microPrice: number;
  microstructure: MicrostructureState;
  previousClose: number;
  open: number;
  high: number;
  low: number;

  marketCap: number;
  sharesOutstanding: number;
  floatShares: number;
  baseLiquidity: number;
  currentLiquidity: number;
  turnover: number;
  volume: number;

  pe: number;
  fairPe: number;
  earningsPerShare: number;
  netProfit: number;
  profitGrowth: number;
  financialHealth: number;

  sentiment: number;
  attention: number;
  momentum: number;
  heat: number;

  buyQueue: number;
  sellQueue: number;
  boardStrength: number;
  boardState: BoardState;

  retail: RetailProfile;
  shrimpCohorts: ShrimpCohort[];
  quantPresence: number;
  institutionPresence: number;

  avgHolderCost: number;
  costDistribution: CostDistribution;
  activeModifiers: Modifier[];
  chart: TickPrice[];
  dailyCandles: DailyCandle[];
  halted: boolean;
};

export type Position = {
  stockId: StockId;
  totalShares: number;
  sellableShares: number;
  lockedShares: number;
  avgCost: number;
  realizedPnl: number;
};

export type Order = {
  id: string;
  owner: "player" | "whale";
  stockId: StockId;
  side: "buy" | "sell";
  style: "market" | "restingBuy" | "split" | "hidden" | "support" | "pullSupport";
  amountCash?: number;
  shares?: number;
  limitPrice?: number;
  remainingTicks?: number;
  visibility: number;
  heatImpact: number;
  createdDay?: number;
  createdTick?: number;
};

export type BearContract = {
  stockId: StockId;
  notional: number;
  entryPrice: number;
  expiryDay: number;
  premiumPaid: number;
};

export type PlayerFund = {
  cash: number;
  netWorth: number;
  realizedPnl: number;
  unrealizedPnl: number;
  influence: number;
  reputation: number;
  accountHeat: number;
  positions: Partial<Record<StockId, Position>>;
  activeOrders: Order[];
  bearContracts: BearContract[];
};

export type NewsItem = {
  id: string;
  title: string;
  source: "market" | "policy" | "financialReport" | "rumor" | "clarification";
  scope: "market" | "sector" | "stock";
  targetId?: string;
  polarity: -1 | 0 | 1;
  strength: number;
  credibility: number;
  durationDays: number;
  remainingDays: number;
  tags: string[];
  heatImpact: number;
};

export type WhaleArchetype =
  | "pumpLord"
  | "quantKnife"
  | "valueWall"
  | "rescueWhale"
  | "bagholderWhale"
  | "sectorRotator"
  | "liquidityVulture";

export type WhaleIntention = "idle" | "accumulate" | "pump" | "defend" | "dump" | "attack" | "rotate" | "scoop";
export type MarketCapClass = "small" | "mid" | "large";
export type WhaleCampaignPhase = "accumulate" | "shakeout" | "markUp" | "distribute";

export type WhaleCampaign = {
  stockId: StockId;
  phase: WhaleCampaignPhase;
  startedDay: number;
  startedTick: number;
  phaseStartedTick: number;
  targetInventoryValue: number;
  note: string;
};

export type Whale = {
  id: string;
  name: string;
  archetype: WhaleArchetype;
  cash: number;
  positions: Partial<Record<StockId, number>>;
  avgCostByStock: Partial<Record<StockId, number>>;
  realizedPnl: number;
  unrealizedPnl: number;
  netWorth: number;
  aggression: number;
  patience: number;
  riskTolerance: number;
  heatTolerance: number;
  preferredCaps: MarketCapClass[];
  preferredSectors: SectorId[];
  targetStockId?: StockId;
  intention: WhaleIntention;
  campaign?: WhaleCampaign;
  nextActionTick?: number;
  strategyNote?: string;
};

export type RegulatorEvent =
  | "warning"
  | "inquiryLetter"
  | "rumorClarification"
  | "tradingHalt"
  | "accountRestriction"
  | "investigation";

export type RegulatorState = {
  strictness: number;
  events: Array<{
    day: number;
    tick: number;
    type: RegulatorEvent;
    stockId?: StockId;
    message: string;
  }>;
};

export type GameEvent = {
  day: number;
  tick: number;
  type: string;
  message: string;
  stockId?: StockId;
};

export type GameState = {
  day: number;
  tick: number;
  phase: GamePhase;
  rngSeed: string;
  market: MarketState;
  sectors: Record<SectorId, SectorState>;
  stocks: Record<StockId, Stock>;
  player: PlayerFund;
  news: NewsItem[];
  whales: Whale[];
  regulator: RegulatorState;
  eventLog: GameEvent[];
};

export type PlayerAction =
  | {
      type: "marketBuy";
      stockId: StockId;
      amountCash: number;
      limitPrice?: number;
    }
  | {
      type: "marketSell";
      stockId: StockId;
      shares: number;
      limitPrice?: number;
    };

export type PressureBreakdown = {
  playerBuyPressure: number;
  playerSellPressure: number;
  retailBuyPressure: number;
  retailSellPressure: number;
  whaleBuyPressure: number;
  whaleSellPressure: number;
  quantBuyPressure: number;
  quantSellPressure: number;
  institutionBuyPressure: number;
  institutionSellPressure: number;
  collectiveBuyPressure: number;
  collectiveSellPressure: number;
  fundamentalBuyPressure: number;
  fundamentalSellPressure: number;
  newsBuyPressure: number;
  newsSellPressure: number;
  noise: number;
};

export type Pressure = PressureBreakdown & {
  buyPressure: number;
  sellPressure: number;
  imbalance: number;
};

export type DepthLevel = {
  price: number;
  availableNotional: number;
};

export type MarketDepth = {
  stockId: StockId;
  marketCapClass: MarketCapClass;
  effectiveDepth: number;
  bidNotional: number;
  askNotional: number;
  bidLevels: DepthLevel[];
  askLevels: DepthLevel[];
};

export type ExecutionFill = {
  owner: "player" | "whale";
  ownerId?: string;
  ownerName?: string;
  intention?: WhaleIntention;
  stockId: StockId;
  side: "buy" | "sell";
  requestedCash?: number;
  requestedShares?: number;
  filledShares: number;
  filledNotional: number;
  avgPrice: number;
  finalPrice: number;
  unfilledCash: number;
  unfilledShares: number;
  liquidityTakenPct: number;
};

export type RestingOrderTrace = {
  orderId: string;
  stockId: StockId;
  remainingCash: number;
  remainingTicks: number;
  visibility: number;
};

export type HeatCauseTrace = {
  source: "player" | "collective" | "whale" | "quant" | "fundamental" | "news" | "board" | "price";
  heatDelta: number;
  sentimentDelta?: number;
  attentionDelta?: number;
  buyPressure?: number;
  sellPressure?: number;
  note: string;
};

export type StockTickTrace = {
  stockId: StockId;
  name: string;
  marketCapClass: MarketCapClass;
  priceBefore: number;
  priceAfter: number;
  changePct: number;
  boardState: BoardState;
  buyQueue: number;
  sellQueue: number;
  boardStrength: number;
  currentLiquidity: number;
  effectiveDepth: number;
  bidNotional: number;
  askNotional: number;
  pressure: Pressure;
  playerFills: ExecutionFill[];
  restingOrders: RestingOrderTrace[];
  whaleTrades: ExecutionFill[];
  heatCauses: HeatCauseTrace[];
};

export type TickResult = {
  day: number;
  tick: number;
  phase: GamePhase;
  phaseChanged?: string;
  stocks: StockTickTrace[];
  playerFills: ExecutionFill[];
  whaleTrades: ExecutionFill[];
  events: GameEvent[];
};
