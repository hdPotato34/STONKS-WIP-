import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Activity, BarChart3, ChevronsRight, Pause, Play, RefreshCw, SkipForward, Star, Wallet } from "lucide-react";
import { GAME_CONFIG, roundMoney } from "../game/config";
import { createInitialGame } from "../game/createInitialGame";
import { getValuationSnapshot } from "../game/fundamentals";
import type { BoardState, DailyCandle, GameState, PlayerAction, Stock, StockId, TickPrice, TickResult } from "../game/types";
import { getLowerLimit, getUpperLimit } from "../simulation/boardEngine";
import { createMarketDepth } from "../simulation/marketDepth";
import { calculateEffectiveDepth, getMarketCapClass } from "../simulation/marketDepth";
import { updateTick } from "../simulation/tick";
import { getReservedCash } from "../player/portfolio";

type TradeSide = "buy" | "sell";
type NavPage = "market" | "fundamentals" | "portfolio";
type KLineRange = 5 | 20 | 60 | "all";
type KLineAxisMode = "auto" | "pct10" | "pct20";
type StockTraceView = TickResult["stocks"][number];
type TradeMark = {
  side: "buy" | "sell";
  day: number;
  tick: number;
  price: number;
  shares: number;
  notional: number;
  count: number;
};
type ChartHover = {
  x: number;
  y: number;
  tick: number;
  coordPrice: number;
  point: TickPrice;
};
type FastForwardState = {
  active: boolean;
  startDay: number;
  restoreRunning: boolean;
};
type WhaleFeedRow = {
  key: string;
  day: number;
  tick: number;
  whale: string;
  side: "buy" | "sell";
  stockId: StockId;
  shares: number;
  avgPrice: number;
  intention: string;
};

const stockIds: StockId[] = [
  "DRAGON_SOFT",
  "NEW_HORIZON_BIO",
  "GOLDEN_ROOF",
  "PEARL_DAILY",
  "RED_RIVER_LITHIUM",
  "HARBOR_BANK",
  "SKY_SHIELD",
  "EAST_GRID_ENERGY"
];

export function App() {
  const gameRef = useRef<GameState>(createInitialUiGame("web-mvp"));
  const [, setGameVersion] = useState(0);
  const game = gameRef.current;
  const [selectedStockId, setSelectedStockId] = useState<StockId>("DRAGON_SOFT");
  const [recentResults, setRecentResults] = useState<TickResult[]>([]);
  const [pendingActions, setPendingActions] = useState<PlayerAction[]>([]);
  const [running, setRunning] = useState(true);
  const [tickIntervalSeconds, setTickIntervalSeconds] = useState<number>(GAME_CONFIG.tickDurationSeconds);
  const [fastForward, setFastForward] = useState<FastForwardState>({ active: false, startDay: 0, restoreRunning: true });
  const [kLineRange, setKLineRange] = useState<KLineRange>(20);
  const [kLineAxisMode, setKLineAxisMode] = useState<KLineAxisMode>("auto");
  const [tradeSide, setTradeSide] = useState<TradeSide>("buy");
  const [showTradeMarks, setShowTradeMarks] = useState(false);
  const [quantity, setQuantity] = useState("10000");
  const [limitPrice, setLimitPrice] = useState(() => gameRef.current.stocks.DRAGON_SOFT.price.toFixed(2));
  const [navPage, setNavPage] = useState<NavPage>("market");
  const [ticketMessage, setTicketMessage] = useState("");
  const pendingActionsRef = useRef<PlayerAction[]>([]);
  const fastForwardRef = useRef<FastForwardState>(fastForward);

  const selectedStock = game.stocks[selectedStockId];
  const selectedTrace = useMemo(() => {
    return recentResults.map((result) => result.stocks.find((stock) => stock.stockId === selectedStockId)).find(Boolean);
  }, [recentResults, selectedStockId]);

  const queueAction = useCallback((action: PlayerAction) => {
    setPendingActions((current) => {
      const next = [...current, action];
      pendingActionsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    fastForwardRef.current = fastForward;
  }, [fastForward]);

  const step = useCallback(() => {
    const nextGame = gameRef.current;
    const actions = pendingActionsRef.current;
    pendingActionsRef.current = [];
    setPendingActions([]);
    const result = updateTick(nextGame, actions);

    setGameVersion((version) => version + 1);
    setRecentResults((current) => [result, ...current].slice(0, 120));
    if (nextGame.phase === "ended") {
      fastForwardRef.current = { active: false, startDay: 0, restoreRunning: false };
      setFastForward(fastForwardRef.current);
      setRunning(false);
    } else if (fastForwardRef.current.active && nextGame.day > fastForwardRef.current.startDay) {
      const restoreRunning = fastForwardRef.current.restoreRunning;
      fastForwardRef.current = { active: false, startDay: 0, restoreRunning };
      setFastForward(fastForwardRef.current);
      setRunning(restoreRunning);
    }
  }, []);

  const effectiveTickIntervalSeconds = fastForward.active ? 0.02 : tickIntervalSeconds;

  useEffect(() => {
    if (!running) return undefined;
    const id = window.setInterval(() => step(), effectiveTickIntervalSeconds * 1000);
    return () => window.clearInterval(id);
  }, [effectiveTickIntervalSeconds, running, step]);

  useEffect(() => {
    setLimitPrice(gameRef.current.stocks[selectedStockId].price.toFixed(2));
    setTicketMessage("");
  }, [selectedStockId]);

  const resetRun = () => {
    const fresh = createInitialUiGame(`web-mvp-${Date.now()}`);
    gameRef.current = fresh;
    setGameVersion((version) => version + 1);
    setRecentResults([]);
    pendingActionsRef.current = [];
    setPendingActions([]);
    setRunning(true);
    fastForwardRef.current = { active: false, startDay: 0, restoreRunning: true };
    setFastForward(fastForwardRef.current);
    setTickIntervalSeconds(GAME_CONFIG.tickDurationSeconds);
    setKLineRange(20);
    setKLineAxisMode("auto");
    setSelectedStockId("DRAGON_SOFT");
    setTradeSide("buy");
    setQuantity("10000");
    setLimitPrice(fresh.stocks.DRAGON_SOFT.price.toFixed(2));
    setTicketMessage("");
  };

  const toggleFastForward = () => {
    const current = fastForwardRef.current;
    if (current.active) {
      fastForwardRef.current = { active: false, startDay: 0, restoreRunning: current.restoreRunning };
      setFastForward(fastForwardRef.current);
      setRunning(current.restoreRunning);
      return;
    }

    const next = {
      active: true,
      startDay: gameRef.current.day,
      restoreRunning: running
    };
    fastForwardRef.current = next;
    setFastForward(next);
    setRunning(true);
  };

  const toggleRunning = () => {
    if (fastForwardRef.current.active) {
      fastForwardRef.current = { active: false, startDay: 0, restoreRunning: false };
      setFastForward(fastForwardRef.current);
      setRunning(false);
      return;
    }

    setRunning((value) => !value);
  };

  const submitOrder = () => {
    const shares = Math.max(0, Math.floor(Number(quantity)));
    const price = Math.max(0, Number(limitPrice));

    if (game.phase !== "intraday" && game.phase !== "closingAuction") {
      setTicketMessage("Trading opens during intraday or closing auction.");
      return;
    }
    if (shares <= 0 || price <= 0) {
      setTicketMessage("Enter a positive share quantity and limit price.");
      return;
    }

    const action: PlayerAction =
      tradeSide === "buy"
        ? {
            type: "marketBuy",
            stockId: selectedStockId,
            amountCash: roundMoney(shares * price),
            limitPrice: price
          }
        : {
            type: "marketSell",
            stockId: selectedStockId,
            shares,
            limitPrice: price
          };

    queueAction(action);
    setTicketMessage(`${tradeSide === "buy" ? "Buy" : "Sell"} order queued for the next tick at limit ${price.toFixed(2)}.`);
  };

  const depth = useMemo(() => {
    const pressure = selectedTrace?.pressure;
    return createMarketDepth(selectedStock, {
      buyPressure: pressure?.buyPressure ?? 0,
      sellPressure: pressure?.sellPressure ?? 0
    });
  }, [selectedStock, selectedTrace]);

  const whaleRows = useMemo(() => {
    return recentResults
      .flatMap((result) =>
        result.whaleTrades.map((trade) => ({
          key: `${result.day}-${result.tick}-${trade.ownerId}-${trade.stockId}-${trade.side}-${trade.filledNotional}`,
          day: result.day,
          tick: result.tick,
          whale: trade.ownerName ?? "Unknown Whale",
          side: trade.side,
          stockId: trade.stockId,
          shares: trade.filledShares,
          avgPrice: trade.avgPrice,
          intention: trade.intention ?? "idle"
        }))
      )
      .slice(0, 12);
  }, [recentResults]);

  const lowerPanelMode = navPage === "portfolio" ? "portfolio" : "fundamentals";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Activity size={21} strokeWidth={2.4} />
          </div>
          <div>
            <div className="brand-title">Whale-Sim</div>
            <div className="brand-subtitle">A-Share Tactics Game</div>
          </div>
        </div>

        <nav className="main-nav" aria-label="Main views">
          {(["market", "fundamentals", "portfolio"] as NavPage[]).map((page) => (
            <button className={navPage === page ? "active" : ""} key={page} onClick={() => setNavPage(page)}>
              {titleCase(page)}
            </button>
          ))}
        </nav>

        <div className="clock-block">
          <div className="clock-item">
            <span>Day</span>
            <strong>{game.day} / {GAME_CONFIG.totalDays}</strong>
          </div>
          <div className="progress-with-skip">
            <ProgressBar
              value={(game.day - 1) / GAME_CONFIG.totalDays}
              dayValue={game.tick / GAME_CONFIG.ticksPerDay}
            />
            <button
              className={fastForward.active ? "fast-forward-button active" : "fast-forward-button"}
              onClick={toggleFastForward}
              type="button"
              aria-label={fastForward.active ? "Stop fast forward" : "Fast forward to next day"}
              title={fastForward.active ? "Stop fast forward" : "Fast forward to next day"}
            >
              <ChevronsRight size={14} strokeWidth={2.4} />
            </button>
          </div>
          <div className="clock-item">
            <span>Tick</span>
            <strong>{game.tick} / {GAME_CONFIG.ticksPerDay}</strong>
          </div>
        </div>

        <div className="run-controls">
          <button className="icon-button primary" onClick={toggleRunning} aria-label={running ? "Pause" : "Play"}>
            {running ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button className="icon-button" onClick={() => step()} aria-label="Next tick">
            <SkipForward size={18} />
          </button>
          <button className="icon-button" onClick={resetRun} aria-label="Reset run">
            <RefreshCw size={17} />
          </button>
          <label className="speed-control">
            <span>Speed</span>
            <select value={tickIntervalSeconds} onChange={(event) => setTickIntervalSeconds(Number(event.target.value))}>
              {[0.25, 0.5, 1, 2, 5].map((speed) => (
                <option key={speed} value={speed}>{speed}s/tick</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <section className="fund-strip" aria-label="Fund state">
        <Metric label="Cash" value={shortMoney(game.player.cash)} />
        <Metric label="Reserved Cash" value={shortMoney(getReservedCash(game))} />
        <Metric label="Net Worth" value={shortMoney(game.player.netWorth)} />
        <Metric label="Unrealized P&L" value={signedShortMoney(game.player.unrealizedPnl)} tone={game.player.unrealizedPnl >= 0 ? "up" : "down"} />
        <Metric label="Realized P&L" value={signedShortMoney(game.player.realizedPnl)} tone={game.player.realizedPnl >= 0 ? "up" : "down"} />
        <Metric label="Account Heat" value={`${game.player.accountHeat.toFixed(0)} / 100`} tone="heat" />
        <Metric label="Influence" value={game.player.influence.toFixed(0)} />
        <Metric label="Reputation" value={game.player.reputation.toFixed(0)} />
      </section>

      <main className="main-grid">
        <MarketOverview game={game} selectedStockId={selectedStockId} onSelect={setSelectedStockId} />
        <StockWorkspace
          game={game}
          stock={selectedStock}
          trace={selectedTrace}
          recentResults={recentResults}
          showTradeMarks={showTradeMarks}
          onToggleTradeMarks={() => setShowTradeMarks((value) => !value)}
          kLineRange={kLineRange}
          kLineAxisMode={kLineAxisMode}
          onKLineRangeChange={setKLineRange}
          onKLineAxisModeChange={setKLineAxisMode}
        />
        <aside className="side-stack">
          <OrderBook depth={depth} />
          <OrderTicket
            game={game}
            stock={selectedStock}
            side={tradeSide}
            quantity={quantity}
            limitPrice={limitPrice}
            message={ticketMessage}
            pendingCount={pendingActions.length}
            onSideChange={setTradeSide}
            onQuantityChange={setQuantity}
            onLimitPriceChange={setLimitPrice}
            onSubmit={submitOrder}
          />
          <WhaleFeed rows={whaleRows} />
        </aside>
        <LowerPanel mode={lowerPanelMode} game={game} stock={selectedStock} />
      </main>
    </div>
  );
}

function MarketOverview({
  game,
  selectedStockId,
  onSelect
}: {
  game: GameState;
  selectedStockId: StockId;
  onSelect: (stockId: StockId) => void;
}) {
  return (
    <section className="panel market-panel">
      <PanelTitle title="Market Overview (A-Share)" icon={<BarChart3 size={15} />} />
      <div className="table-scroll">
        <table className="market-table">
          <thead>
            <tr>
              <th>Stock</th>
              <th>Sector</th>
              <th>Board</th>
              <th>Price</th>
              <th>Chg</th>
              <th>State</th>
              <th>Attn</th>
              <th>Sent</th>
              <th>Heat</th>
              <th>Turn</th>
              <th>Vol</th>
            </tr>
          </thead>
          <tbody>
            {stockIds.map((stockId) => {
              const stock = game.stocks[stockId];
              const change = dailyChangePct(stock);
              return (
                <tr
                  key={stock.id}
                  className={stock.id === selectedStockId ? "selected" : ""}
                  onClick={() => onSelect(stock.id)}
                >
                  <td>
                    <strong>{stock.id}</strong>
                    <span>{stock.name}</span>
                  </td>
                  <td>{sectorLabel(stock.sector)}</td>
                  <td>{boardShortLabel(stock.boardType)}</td>
                  <td>{stock.price.toFixed(2)}</td>
                  <td className={change >= 0 ? "tone-up" : "tone-down"}>{signedPct(change)}</td>
                  <td>
                    <span className={`state-chip ${stateClass(stock.boardState)}`}>{boardStateLabel(stock.boardState)}</span>
                  </td>
                  <td>{stock.attention.toFixed(0)}</td>
                  <td>{stock.sentiment.toFixed(0)}</td>
                  <td className={stock.heat > 65 ? "tone-heat" : ""}>{stock.heat.toFixed(0)}</td>
                  <td>{compactMoney(stock.turnover)}</td>
                  <td>{shortShares(stock.volume)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="panel-foot">
        <span>Turnover in CNY</span>
        <span>Volume in shares</span>
      </div>
    </section>
  );
}

function StockWorkspace({
  game,
  stock,
  trace,
  recentResults,
  showTradeMarks,
  onToggleTradeMarks,
  kLineRange,
  kLineAxisMode,
  onKLineRangeChange,
  onKLineAxisModeChange
}: {
  game: GameState;
  stock: Stock;
  trace?: StockTraceView;
  recentResults: TickResult[];
  showTradeMarks: boolean;
  onToggleTradeMarks: () => void;
  kLineRange: KLineRange;
  kLineAxisMode: KLineAxisMode;
  onKLineRangeChange: (range: KLineRange) => void;
  onKLineAxisModeChange: (mode: KLineAxisMode) => void;
}) {
  const position = game.player.positions[stock.id];
  const valuation = getValuationSnapshot(stock);
  const activeNews = game.news.filter((news) => news.scope === "market" || news.targetId === stock.id || news.targetId === stock.sector);
  const tradeMarks = useMemo(() => createTradeMarks(recentResults, stock.id, game.day), [game.day, recentResults, stock.id]);

  return (
    <section className="panel stock-panel">
      <div className="stock-header">
        <div>
          <div className="stock-title-line">
            <Star size={18} />
            <h1>{stock.id}</h1>
            <span className="board-badge">{boardLabel(stock.boardType)}</span>
          </div>
          <div className="muted">{stock.name}</div>
          <div className={dailyChangePct(stock) >= 0 ? "price-line tone-up" : "price-line tone-down"}>
            {stock.price.toFixed(2)}
            <span>{signedMoney(stock.price - stock.previousClose)} ({signedPct(dailyChangePct(stock))})</span>
          </div>
        </div>
        <div className="info-matrix">
          <InfoCell label="Market Cap" value={shortMoney(stock.marketCap)} />
          <InfoCell label="P/E" value={stock.pe.toFixed(1)} />
          <InfoCell label="Fair P/E" value={stock.fairPe.toFixed(1)} />
          <InfoCell label="Turnover" value={shortMoney(stock.turnover)} />
          <InfoCell label="Liquidity" value={shortMoney(stock.currentLiquidity)} />
          <InfoCell label="Prev Close" value={stock.previousClose.toFixed(2)} />
          <InfoCell label="Upper Limit" value={getUpperLimit(stock).toFixed(2)} tone="up" />
          <InfoCell label="Lower Limit" value={getLowerLimit(stock).toFixed(2)} tone="down" />
          <InfoCell label="Valuation" value={valuation.overvalued ? "Rich" : valuation.undervalued ? "Cheap" : "Fair"} />
        </div>
      </div>

      <div className="signal-row">
        <Signal label="Buy Pressure" value={trace ? shortMoney(trace.pressure.buyPressure) : "-"} tone="up" />
        <Signal label="Sell Pressure" value={trace ? shortMoney(trace.pressure.sellPressure) : "-"} tone="down" />
        <Signal label="Buy Queue" value={shortMoney(stock.buyQueue)} tone="up" />
        <Signal label="Sell Queue" value={shortMoney(stock.sellQueue)} tone="down" />
        <Signal label="Board Strength" value={stock.boardStrength.toFixed(0)} />
        <Signal label="Depth" value={shortMoney(trace?.effectiveDepth ?? calculateEffectiveDepth(stock))} />
      </div>

      <div className="chart-grid">
        <div className="chart-card">
          <div className="chart-head">
            <strong>Intraday</strong>
            <span>09:30-15:00 / {GAME_CONFIG.ticksPerDay} ticks</span>
          </div>
          <IntradayChart
            chart={stock.chart}
            previousClose={stock.previousClose}
            currentDay={game.day}
            tradeMarks={tradeMarks}
            showTradeMarks={showTradeMarks}
            onToggleTradeMarks={onToggleTradeMarks}
          />
        </div>
        <div className="chart-card">
          <div className="chart-head">
            <strong>K-Line</strong>
            <div className="chart-tools">
              <div className="range-tabs" aria-label="K-line range">
                {([5, 20, 60, "all"] as KLineRange[]).map((range) => (
                  <button
                    className={kLineRange === range ? "active" : ""}
                    key={range}
                    onClick={() => onKLineRangeChange(range)}
                    type="button"
                  >
                    {range === "all" ? "All" : `${range}D`}
                  </button>
                ))}
              </div>
              <select
                className="axis-select"
                value={kLineAxisMode}
                onChange={(event) => onKLineAxisModeChange(event.target.value as KLineAxisMode)}
                aria-label="K-line price axis"
              >
                <option value="auto">Auto</option>
                <option value="pct10">10%</option>
                <option value="pct20">20%</option>
              </select>
            </div>
          </div>
          <KLineChart candles={stock.dailyCandles} range={kLineRange} axisMode={kLineAxisMode} currentDay={game.day} />
        </div>
      </div>

      <div className="micro-grid">
        <InfoCell label="Retail Attention" value={stock.retail.attention.toFixed(0)} />
        <InfoCell label="Retail Fear" value={stock.retail.fear.toFixed(0)} />
        <InfoCell label="Retail Greed" value={stock.retail.greed.toFixed(0)} />
        <InfoCell label="Sector Sentiment" value={game.sectors[stock.sector].sentiment.toFixed(0)} />
        <InfoCell label="Stock Heat" value={stock.heat.toFixed(0)} tone="heat" />
        <InfoCell label="Position" value={position ? shortShares(position.totalShares) : "0"} />
        <InfoCell label="Sellable" value={position ? shortShares(position.sellableShares) : "0"} />
        <InfoCell label="Locked" value={position ? shortShares(position.lockedShares) : "0"} />
        <InfoCell label="Average Cost" value={position ? position.avgCost.toFixed(2) : "-"} />
        <InfoCell label="Active News" value={activeNews.length.toString()} />
        <InfoCell label="Whale Prints" value={recentResults.reduce((total, result) => total + result.whaleTrades.filter((trade) => trade.stockId === stock.id).length, 0).toString()} />
        <InfoCell label="Quant Activity" value={quantHint(stock.quantPresence, trace)} />
      </div>
    </section>
  );
}

function OrderBook({ depth }: { depth: ReturnType<typeof createMarketDepth> }) {
  const asks = depth.askLevels.slice(0, 5).reverse();
  const bids = depth.bidLevels.slice(0, 5);

  return (
    <section className="panel side-panel order-book">
      <PanelTitle title="Order Book (5)" />
      <div className="book-table">
        <div className="book-row book-head">
          <span>Ask</span>
          <span>Price</span>
          <span>Available</span>
        </div>
        {asks.map((level, index) => (
          <div className="book-row ask" key={`ask-${level.price}-${index}`}>
            <span>{asks.length - index}</span>
            <strong>{level.price.toFixed(2)}</strong>
            <span>{shortMoney(level.availableNotional)}</span>
          </div>
        ))}
        <div className="spread-line">
          <span>Spread</span>
          <strong>{spread(depth).toFixed(2)}</strong>
        </div>
        {bids.map((level, index) => (
          <div className="book-row bid" key={`bid-${level.price}-${index}`}>
            <span>{index + 1}</span>
            <strong>{level.price.toFixed(2)}</strong>
            <span>{shortMoney(level.availableNotional)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function OrderTicket({
  game,
  stock,
  side,
  quantity,
  limitPrice,
  message,
  pendingCount,
  onSideChange,
  onQuantityChange,
  onLimitPriceChange,
  onSubmit
}: {
  game: GameState;
  stock: Stock;
  side: TradeSide;
  quantity: string;
  limitPrice: string;
  message: string;
  pendingCount: number;
  onSideChange: (side: TradeSide) => void;
  onQuantityChange: (value: string) => void;
  onLimitPriceChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const shares = Math.max(0, Math.floor(Number(quantity) || 0));
  const price = Math.max(0, Number(limitPrice) || 0);
  const notional = shares * price;
  const position = game.player.positions[stock.id];
  const canTrade = game.phase === "intraday" || game.phase === "closingAuction";
  const applyPositionFraction = (fraction: number) => {
    if (side === "buy") {
      const referencePrice = price > 0 ? price : stock.price;
      const targetShares = referencePrice > 0 ? Math.floor((game.player.cash * fraction) / referencePrice) : 0;
      onQuantityChange(targetShares.toString());
      return;
    }

    const targetShares = Math.floor((position?.sellableShares ?? 0) * fraction);
    onQuantityChange(targetShares.toString());
  };
  const applyPrice = (nextPrice: number) => {
    onLimitPriceChange(Math.max(0, nextPrice).toFixed(2));
  };

  return (
    <section className="panel side-panel ticket-panel">
      <PanelTitle title="Order Ticket" icon={<Wallet size={14} />} />
      <div className="ticket-body">
        <div className="segmented">
          <button
            aria-pressed={side === "buy"}
            className={side === "buy" ? "buy active" : "buy"}
            onClick={() => onSideChange("buy")}
            type="button"
          >
            Buy
          </button>
          <button
            aria-pressed={side === "sell"}
            className={side === "sell" ? "sell active" : "sell"}
            onClick={() => onSideChange("sell")}
            type="button"
          >
            Sell
          </button>
        </div>
        <div className="field-row">
          <span>Quantity (Shares)</span>
          <QuickPicker
            label="Position size"
            trigger="%"
            options={[
              { label: "1/10", onSelect: () => applyPositionFraction(0.1) },
              { label: "1/4", onSelect: () => applyPositionFraction(0.25) },
              { label: "1/2", onSelect: () => applyPositionFraction(0.5) },
              { label: "All", onSelect: () => applyPositionFraction(1) }
            ]}
          />
          <input inputMode="numeric" value={quantity} onChange={(event) => onQuantityChange(event.target.value)} />
        </div>
        <div className="field-row">
          <span>Limit Price (CNY)</span>
          <QuickPicker
            label="Price presets"
            trigger="P"
            options={[
              { label: "Current", onSelect: () => applyPrice(stock.price) },
              { label: "Open", onSelect: () => applyPrice(stock.open) },
              { label: "Limit Up", onSelect: () => applyPrice(getUpperLimit(stock)) },
              { label: "Limit Down", onSelect: () => applyPrice(getLowerLimit(stock)) }
            ]}
          />
          <input inputMode="decimal" value={limitPrice} onChange={(event) => onLimitPriceChange(event.target.value)} />
        </div>
        <div className="ticket-summary">
          <div>
            <span>Est. Notional</span>
            <strong className={side === "buy" ? "tone-up" : "tone-down"}>{money(notional)}</strong>
          </div>
          <div>
            <span>{side === "buy" ? "Available Cash" : "Sellable Shares"}</span>
            <strong>{side === "buy" ? money(game.player.cash) : shortShares(position?.sellableShares ?? 0)}</strong>
          </div>
        </div>
        <button className={`submit-order ${side}`} onClick={onSubmit} disabled={!canTrade}>
          {canTrade ? `Queue ${side === "buy" ? "Buy" : "Sell"} Order` : "Trading Closed"}
        </button>
        <div className="ticket-message">{message || `${stock.id} ${game.phase}`}</div>
        <div className="pending-line">{pendingCount > 0 ? `${pendingCount} queued for next tick` : "Orders execute on the next timed tick."}</div>
      </div>
    </section>
  );
}

function QuickPicker({
  label,
  trigger,
  options
}: {
  label: string;
  trigger: string;
  options: Array<{ label: string; onSelect: () => void }>;
}) {
  return (
    <div className="quick-picker">
      <button className="quick-trigger" type="button" aria-label={label} title={label}>
        {trigger}
      </button>
      <div className="quick-popover" role="menu" aria-label={label}>
        {options.map((option) => (
          <button key={option.label} type="button" onClick={option.onSelect} role="menuitem">
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function WhaleFeed({ rows }: { rows: WhaleFeedRow[] }) {
  return (
    <section className="panel side-panel whale-feed">
      <PanelTitle title="Whale Trades (Live)" />
      <div className="whale-rows">
        <div className="whale-row whale-head">
          <span>Time</span>
          <span>Whale</span>
          <span>Side</span>
          <span>Stock</span>
          <span>Shares</span>
          <span>Avg</span>
          <span>Intent</span>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">No whale prints yet.</div>
        ) : (
          rows.map((row) => (
            <div className="whale-row" key={row.key}>
              <span>D{row.day} T{row.tick}</span>
              <strong>{row.whale}</strong>
              <span className={row.side === "buy" ? "tone-up" : "tone-down"}>{titleCase(row.side)}</span>
              <span>{row.stockId}</span>
              <span>{shortShares(row.shares)}</span>
              <span>{row.avgPrice.toFixed(2)}</span>
              <span>{titleCase(row.intention)}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function LowerPanel({ mode, game, stock }: { mode: "fundamentals" | "portfolio"; game: GameState; stock: Stock }) {
  return (
    <section className="panel lower-panel">
      {mode === "portfolio" ? <PortfolioPanel game={game} /> : <FundamentalsPanel game={game} stock={stock} />}
    </section>
  );
}

function FundamentalsPanel({ game, stock }: { game: GameState; stock: Stock }) {
  const valuation = getValuationSnapshot(stock);
  const news = game.news.filter((item) => item.scope === "market" || item.targetId === stock.id || item.targetId === stock.sector);

  return (
    <>
      <div className="lower-tabs">
        <button className="active">Fundamentals</button>
        <button>Financials</button>
        <button>News</button>
        <button>Notes</button>
      </div>
      <div className="fundamentals-grid">
        <DataCard title="Valuation" rows={[
          ["P/E", stock.pe.toFixed(1)],
          ["Fair P/E", stock.fairPe.toFixed(1)],
          ["Fair Value", valuation.fairValue.toFixed(2)],
          ["Profit Yield", `${valuation.profitYield.toFixed(2)}%`]
        ]} />
        <DataCard title="Profitability" rows={[
          ["Net Profit", shortMoney(stock.netProfit)],
          ["EPS", stock.earningsPerShare.toFixed(2)],
          ["Growth", signedPct(stock.profitGrowth)],
          ["Health", stock.financialHealth.toFixed(0)]
        ]} />
        <DataCard title="Market Texture" rows={[
          ["Cap Class", titleCase(getMarketCapClass(stock))],
          ["Float", shortShares(stock.floatShares)],
          ["Liquidity", shortMoney(stock.currentLiquidity)],
          ["Turnover", shortMoney(stock.turnover)]
        ]} />
        <CostDistributionCard stock={stock} />
        <div className="data-card news-card">
          <h3>Active News</h3>
          {news.length === 0 ? (
            <p className="muted">No active news for this stock.</p>
          ) : (
            news.slice(0, 3).map((item) => (
              <div className="news-line" key={item.id}>
                <strong>{item.title}</strong>
                <span>{titleCase(item.source)} | strength {item.strength} | credibility {item.credibility}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function PortfolioPanel({ game }: { game: GameState }) {
  const positions = Object.values(game.player.positions).filter(Boolean);
  return (
    <>
      <div className="lower-tabs">
        <button className="active">Portfolio</button>
        <button>Resting Orders</button>
        <button>Bear Contracts</button>
      </div>
      <div className="portfolio-grid">
        <table className="portfolio-table">
          <thead>
            <tr>
              <th>Stock</th>
              <th>Shares Held</th>
              <th>Sellable</th>
              <th>T+1 Locked</th>
              <th>Average Cost</th>
              <th>Current Price</th>
              <th>Unrealized P&L</th>
              <th>Realized P&L</th>
              <th>Liquidity Risk</th>
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty-row">No positions yet.</td>
              </tr>
            ) : (
              positions.map((position) => {
                if (!position) return null;
                const stock = game.stocks[position.stockId];
                const unrealized = (stock.price - position.avgCost) * position.totalShares;
                return (
                  <tr key={position.stockId}>
                    <td><strong>{position.stockId}</strong></td>
                    <td>{shortShares(position.totalShares)}</td>
                    <td>{shortShares(position.sellableShares)}</td>
                    <td>{shortShares(position.lockedShares)}</td>
                    <td>{position.avgCost.toFixed(2)}</td>
                    <td>{stock.price.toFixed(2)}</td>
                    <td className={unrealized >= 0 ? "tone-up" : "tone-down"}>{signedMoney(unrealized)}</td>
                    <td className={position.realizedPnl >= 0 ? "tone-up" : "tone-down"}>{signedMoney(position.realizedPnl)}</td>
                    <td>{liquidityRisk(stock)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        <div className="resting-list">
          <h3>Resting Orders</h3>
          {game.player.activeOrders.length === 0 ? (
            <p className="muted">No resting orders.</p>
          ) : (
            game.player.activeOrders.map((order) => (
              <div className="resting-item" key={order.id}>
                <strong>{order.stockId}</strong>
                <span>{titleCase(order.side)} {money(order.amountCash ?? 0)}</span>
                <span>{order.limitPrice ? `limit ${order.limitPrice.toFixed(2)}` : "marketable"}</span>
                <span>{order.remainingTicks ?? 0} ticks</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function IntradayChart({
  chart,
  previousClose,
  currentDay,
  tradeMarks,
  showTradeMarks,
  onToggleTradeMarks
}: {
  chart: TickPrice[];
  previousClose: number;
  currentDay: number;
  tradeMarks: TradeMark[];
  showTradeMarks: boolean;
  onToggleTradeMarks: () => void;
}) {
  const [hover, setHover] = useState<ChartHover | undefined>();
  const points = chart.filter((point) => point.day === currentDay);
  const prices = points.map((point) => point.price);
  const min = Math.min(...prices, previousClose);
  const max = Math.max(...prices, previousClose);
  const span = Math.max(0.01, max - min);
  const pad = span * 0.16;
  const low = min - pad;
  const high = max + pad;
  const width = 360;
  const height = 172;
  const lastTickIndex = Math.max(1, GAME_CONFIG.ticksPerDay - 1);
  const xForTick = (tick: number) => (Math.min(lastTickIndex, Math.max(0, tick)) / lastTickIndex) * width;
  const xFor = (point: TickPrice) => xForTick(point.tick);
  const yFor = (price: number) => height - ((price - low) / (high - low)) * height;
  const priceForY = (y: number) => high - (y / height) * (high - low);
  const path = points.map((point) => `${xFor(point).toFixed(1)},${yFor(point.price).toFixed(1)}`).join(" ");
  const baseline = yFor(previousClose);
  const last = points[points.length - 1];
  const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
    if (points.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(width, Math.max(0, ((event.clientX - rect.left) / rect.width) * width));
    const y = Math.min(height, Math.max(0, ((event.clientY - rect.top) / rect.height) * height));
    const tick = Math.round((x / width) * lastTickIndex);
    const point = findNearestTickPoint(points, tick);
    setHover({
      x,
      y,
      tick,
      coordPrice: priceForY(y),
      point
    });
  };

  return (
    <div className="intraday-frame">
      <svg
        className="chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Intraday price chart"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(undefined)}
      >
        <GridLines width={width} height={height} xLines={[0.25, 0.5, 0.75]} />
        <line x1="0" x2={width} y1={baseline} y2={baseline} className="baseline" />
        <polyline points={path} className="intraday-line" />
        {points.map((point) =>
          point.boardState === "sealedLimitUp" || point.boardState === "limitDown" ? (
            <circle
              key={`${point.day}-${point.tick}`}
              cx={xFor(point)}
              cy={yFor(point.price)}
              r="3"
              className={point.boardState === "sealedLimitUp" ? "event-dot up" : "event-dot down"}
            />
          ) : null
        )}
        {showTradeMarks
          ? tradeMarks.map((mark) => {
              const x = xForTick(mark.tick);
              const y = yFor(mark.price);
              const textY = mark.side === "buy" ? y - 7 : y + 12;
              return (
                <g className={`trade-mark ${mark.side}`} key={`${mark.side}-${mark.day}-${mark.tick}-${mark.count}`}>
                  <title>
                    {`${mark.side.toUpperCase()} ${shortShares(mark.shares)} @ ${mark.price.toFixed(2)} | ${shortMoney(mark.notional)}${
                      mark.count > 1 ? ` | ${mark.count} fills` : ""
                    }`}
                  </title>
                  <circle cx={x} cy={y} r="3.2" />
                  <text x={x + 5} y={textY}>{mark.side === "buy" ? "B" : "S"}</text>
                </g>
              );
            })
          : null}
        {last ? (
          <>
            <circle cx={xFor(last)} cy={yFor(last.price)} r="3.5" className="last-dot" />
            <text x={Math.min(width - 4, xFor(last) + 34)} y={Math.max(12, yFor(last.price) - 7)} className="price-tag" textAnchor="end">{last.price.toFixed(2)}</text>
          </>
        ) : null}
        {hover ? (
          <g className="chart-hover-layer">
            <line x1={xForTick(hover.tick)} x2={xForTick(hover.tick)} y1="0" y2={height} />
            <line x1="0" x2={width} y1={hover.y} y2={hover.y} />
            <circle cx={xFor(hover.point)} cy={yFor(hover.point.price)} r="3.4" />
            <rect x="4" y="4" width="122" height="34" rx="4" />
            <text x="10" y="17">{formatIntradayTime(hover.point.tick)} price {hover.point.price.toFixed(2)}</text>
            <text x="10" y="31">{signedPct(((hover.point.price - previousClose) / previousClose) * 100)}</text>
            <text x={width} y={Math.min(height - 20, Math.max(12, hover.y - 5))} textAnchor="end">
              cursor {hover.coordPrice.toFixed(2)}
            </text>
          </g>
        ) : null}
        <g className="axis-labels">
          <text x="0" y={height - 2}>09:30</text>
          <text x={xForTick(120)} y={height - 2} textAnchor="middle">11:30</text>
          <text x={xForTick(150)} y={height - 2} textAnchor="middle">13:00</text>
          <text x={width} y={height - 2} textAnchor="end">15:00</text>
        </g>
        <g className="axis-labels price-axis">
          <text x={width} y="10" textAnchor="end">{high.toFixed(2)}</text>
          <text x={width} y={Math.max(20, baseline - 4)} textAnchor="end">prev {previousClose.toFixed(2)}</text>
          <text x={width} y={height - 16} textAnchor="end">{low.toFixed(2)}</text>
        </g>
      </svg>
      <button
        className={showTradeMarks ? "trade-mark-toggle active" : "trade-mark-toggle"}
        type="button"
        onClick={onToggleTradeMarks}
        aria-pressed={showTradeMarks}
        aria-label="Toggle buy and sell marks"
      >
        <span />
        B/S
      </button>
    </div>
  );
}

function KLineChart({
  candles,
  range,
  axisMode,
  currentDay
}: {
  candles: DailyCandle[];
  range: KLineRange;
  axisMode: KLineAxisMode;
  currentDay: number;
}) {
  const closedCandles = candles.filter((candle) => candle.day < currentDay);
  const rangeSize = range === "all" ? closedCandles.length : range;
  const visibleCandles = closedCandles.slice(-rangeSize);
  const prices = visibleCandles.flatMap((candle) => [candle.high, candle.low]);
  if (visibleCandles.length === 0 || prices.length === 0) {
    return <svg className="chart-svg" viewBox="0 0 360 172" role="img" aria-label="K-line candlestick chart" />;
  }
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = Math.max(0.01, max - min);
  const lastClose = visibleCandles.at(-1)?.close ?? max;
  const axisPct = axisMode === "pct10" ? 0.1 : axisMode === "pct20" ? 0.2 : undefined;
  const low = axisPct === undefined ? min - span * 0.18 : Math.min(min, lastClose * (1 - axisPct));
  const high = axisPct === undefined ? max + span * 0.18 : Math.max(max, lastClose * (1 + axisPct));
  const width = 360;
  const height = 172;
  const priceHeight = 132;
  const volumeTop = 138;
  const slotCount = Math.max(5, visibleCandles.length);
  const candleWidth = Math.max(4, Math.min(13, width / slotCount - 5));
  const xFor = (index: number) => (visibleCandles.length <= 1 ? 14 : 10 + (index / Math.max(1, visibleCandles.length - 1)) * (width - 20));
  const yFor = (price: number) => priceHeight - ((price - low) / (high - low)) * priceHeight;
  const maxVolume = Math.max(1, ...visibleCandles.map((candle) => candle.volume));
  const volumeY = (volume: number) => volumeTop + 28 - (volume / maxVolume) * 28;
  const ma = visibleCandles.map((_, index) => {
    const slice = visibleCandles.slice(Math.max(0, index - 4), index + 1);
    return slice.reduce((sum, candle) => sum + candle.close, 0) / slice.length;
  });
  const ma10 = visibleCandles.map((_, index) => {
    const slice = visibleCandles.slice(Math.max(0, index - 9), index + 1);
    return slice.reduce((sum, candle) => sum + candle.close, 0) / slice.length;
  });
  const maPath = ma.map((price, index) => `${xFor(index).toFixed(1)},${yFor(price).toFixed(1)}`).join(" ");
  const ma10Path = ma10.map((price, index) => `${xFor(index).toFixed(1)},${yFor(price).toFixed(1)}`).join(" ");

  return (
    <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="K-line candlestick chart">
      <GridLines width={width} height={height} xLines={[0.25, 0.5, 0.75]} />
      {visibleCandles.map((candle, index) => {
        const up = candle.close >= candle.open;
        const x = xFor(index);
        const openY = yFor(candle.open);
        const closeY = yFor(candle.close);
        const bodyY = Math.min(openY, closeY);
        const bodyHeight = Math.max(2, Math.abs(openY - closeY));
        return (
          <g key={`${candle.day}-${index}`} className={up ? "candle up" : "candle down"}>
            <line x1={x} x2={x} y1={yFor(candle.high)} y2={yFor(candle.low)} />
            <rect x={x - candleWidth / 2} y={bodyY} width={candleWidth} height={bodyHeight} rx="1" />
            <rect className="volume-bar" x={x - candleWidth / 2} y={volumeY(candle.volume)} width={candleWidth} height={volumeTop + 28 - volumeY(candle.volume)} rx="1" />
          </g>
        );
      })}
      <polyline points={maPath} className="ma-line" />
      <polyline points={ma10Path} className="ma-line secondary" />
      <g className="ma-legend">
        <text x="0" y="11">MA5</text>
        <text x="31" y="11" className="secondary">MA10</text>
      </g>
      <g className="axis-labels">
        <text x="0" y={height - 2}>{formatDayLabel(visibleCandles[0].day)}</text>
        <text x={width} y={height - 2} textAnchor="end">{formatDayLabel(visibleCandles.at(-1)?.day ?? 1)}</text>
      </g>
      <g className="axis-labels price-axis">
        <text x={width} y="10" textAnchor="end">{high.toFixed(2)}</text>
        <text x={width} y={priceHeight - 3} textAnchor="end">{low.toFixed(2)}</text>
      </g>
    </svg>
  );
}

function GridLines({ width, height, xLines = [0.25, 0.5, 0.75] }: { width: number; height: number; xLines?: number[] }) {
  return (
    <g className="grid-lines">
      {[0.25, 0.5, 0.75].map((line) => (
        <line key={`h-${line}`} x1="0" x2={width} y1={height * line} y2={height * line} />
      ))}
      {xLines.map((line) => (
        <line key={`v-${line}`} y1="0" y2={height} x1={width * line} x2={width * line} />
      ))}
    </g>
  );
}

function CostDistributionCard({ stock }: { stock: Stock }) {
  const rows = [
    ["> +10%", stock.costDistribution.deepProfit, "up"],
    ["0% to +10%", stock.costDistribution.profit, "up-soft"],
    ["-10% to 0%", stock.costDistribution.nearCost, "down-soft"],
    ["< -10%", stock.costDistribution.loss + stock.costDistribution.deepLoss, "down"]
  ] as const;

  return (
    <div className="data-card cost-card">
      <h3>Holder Cost Distribution</h3>
      {rows.map(([label, value, tone]) => (
        <div className="cost-row" key={label}>
          <span>{label}</span>
          <div className="cost-track">
            <div className={`cost-fill ${tone}`} style={{ width: `${Math.min(100, value)}%` }} />
          </div>
          <strong>{value.toFixed(1)}%</strong>
        </div>
      ))}
    </div>
  );
}

function DataCard({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="data-card">
      <h3>{title}</h3>
      {rows.map(([label, value]) => (
        <div className="data-row" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function PanelTitle({ title, icon }: { title: string; icon?: ReactNode }) {
  return (
    <div className="panel-title">
      <div>{icon}{title}</div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" | "heat" }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={tone ? `tone-${tone}` : ""}>{value}</strong>
    </div>
  );
}

function InfoCell({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" | "heat" }) {
  return (
    <div className="info-cell">
      <span>{label}</span>
      <strong className={tone ? `tone-${tone}` : ""}>{value}</strong>
    </div>
  );
}

function Signal({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="signal">
      <span>{label}</span>
      <strong className={tone ? `tone-${tone}` : ""}>{value}</strong>
    </div>
  );
}

function ProgressBar({ value, dayValue }: { value: number; dayValue?: number }) {
  return (
    <div className="progress">
      <div className="run-progress-track">
        <div className="run-progress-fill" style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
      </div>
      {dayValue === undefined ? null : (
        <div className="day-progress-track" aria-hidden="true">
          <div className="day-progress-fill" style={{ width: `${Math.max(2, Math.min(100, dayValue * 100))}%` }} />
          <span className="midday-marker" />
        </div>
      )}
    </div>
  );
}

function createTradeMarks(results: TickResult[], stockId: StockId, currentDay: number): TradeMark[] {
  const fills = [...results]
    .reverse()
    .flatMap((result) =>
      result.playerFills
        .filter((fill) => fill.stockId === stockId && fill.filledShares > 0)
        .map((fill) => ({
          side: fill.side,
          day: result.day,
          tick: result.tick,
          price: fill.avgPrice > 0 ? fill.avgPrice : fill.finalPrice,
          shares: fill.filledShares,
          notional: fill.filledNotional
        }))
    )
    .filter((fill) => fill.day === currentDay)
    .sort((a, b) => a.tick - b.tick);
  const marks: TradeMark[] = [];

  for (const fill of fills) {
    const last = marks.at(-1);
    if (last && last.side === fill.side && fill.tick - last.tick <= 8) {
      const totalNotional = last.notional + fill.notional;
      const totalShares = last.shares + fill.shares;
      last.tick = fill.tick;
      last.shares = totalShares;
      last.notional = totalNotional;
      last.price = totalShares > 0 ? totalNotional / totalShares : fill.price;
      last.count += 1;
    } else {
      marks.push({
        ...fill,
        count: 1
      });
    }
  }

  return marks;
}

function findNearestTickPoint(points: TickPrice[], tick: number): TickPrice {
  return points.reduce((nearest, point) => (Math.abs(point.tick - tick) < Math.abs(nearest.tick - tick) ? point : nearest), points[0]);
}

function formatIntradayTime(tick: number): string {
  const clampedTick = Math.max(0, Math.min(GAME_CONFIG.ticksPerDay, tick));
  const minutes = clampedTick <= 120 ? clampedTick : clampedTick <= 150 ? 120 : clampedTick - 30;
  const totalMinutes = 9 * 60 + 30 + minutes;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function createInitialUiGame(seed: string) {
  const game = createInitialGame(seed);
  updateTick(game);
  updateTick(game);
  return game;
}

function money(value: number) {
  return `CNY ${Math.round(value).toLocaleString()}`;
}

function shortMoney(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `CNY ${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `CNY ${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `CNY ${(value / 1_000).toFixed(1)}K`;
  return `CNY ${value.toFixed(0)}`;
}

function compactMoney(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

function signedMoney(value: number) {
  return `${value >= 0 ? "+" : ""}${money(value)}`;
}

function signedShortMoney(value: number) {
  return `${value >= 0 ? "+" : ""}${shortMoney(value)}`;
}

function shortShares(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Math.floor(value).toLocaleString();
}

function signedPct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatDayLabel(day: number) {
  return day < 1 ? `D${day}` : `D${day}`;
}

function dailyChangePct(stock: Stock) {
  return ((stock.price - stock.previousClose) / stock.previousClose) * 100;
}

function sectorLabel(value: string) {
  return titleCase(value);
}

function boardLabel(value: string) {
  if (value === "growth") return "SZ Growth";
  if (value === "main") return "Main";
  return value.toUpperCase();
}

function boardShortLabel(value: string) {
  if (value === "growth") return "Growth";
  if (value === "main") return "Main";
  return value.toUpperCase();
}

function boardStateLabel(value: BoardState) {
  return value.replace(/[A-Z]/g, (letter) => ` ${letter}`).replace(/^./, (letter) => letter.toUpperCase());
}

function stateClass(value: BoardState) {
  if (value === "sealedLimitUp" || value === "attackingLimitUp") return "hot";
  if (value === "panic" || value === "limitDown" || value === "brokenBoard") return "cold";
  if (value === "weakSeal") return "watch";
  return "normal";
}

function spread(depth: ReturnType<typeof createMarketDepth>) {
  const ask = depth.askLevels[0]?.price ?? 0;
  const bid = depth.bidLevels[0]?.price ?? 0;
  return Math.max(0, ask - bid);
}

function liquidityRisk(stock: Stock) {
  const depth = calculateEffectiveDepth(stock);
  const ratio = stock.marketCap > 0 ? depth / stock.marketCap : 0;
  if (ratio < 0.0002) return "High";
  if (ratio < 0.0006) return "Medium";
  return "Low";
}

function quantHint(quantPresence: number, trace?: StockTraceView) {
  const sell = trace?.pressure.quantSellPressure ?? 0;
  const buy = trace?.pressure.quantBuyPressure ?? 0;
  if (sell > buy * 1.4 && sell > 0) return "Algo selling";
  if (buy > sell * 1.4 && buy > 0) return "Fast bid";
  if (quantPresence > 65) return "Fast money";
  return "Quiet";
}

function titleCase(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
