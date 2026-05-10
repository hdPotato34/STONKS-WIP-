# DEV_LOG

## Current Position

Project status: market-depth, strategic whale, fundamentals-aware, market-memory, and explainability-trace kernel implemented.

The folder started with design notes only:

- `How-to Play.txt`
- `Project-Spec.txt`

The first implementation pass added a TypeScript headless market kernel:

- project tooling in `package.json` and `tsconfig.json`
- deterministic RNG
- shared domain types
- initial sectors, fictional stocks, and whale archetypes
- initial game-state factory
- player market buy/sell accounting
- T+1 locked/sellable position handling
- basic pressure, price, liquidity, and board-state engines
- daily settlement
- headless runner
- deterministic tests

The second implementation pass replaced immediate guaranteed fills with a virtual depth/execution layer:

- market cap class is now derived as small, mid, or large
- effective depth now depends on current liquidity, market cap class, and float value
- player market buys consume virtual ask depth instead of always filling
- unfilled player buy cash becomes visible resting buy interest
- reserved resting cash is unavailable for new orders but remains part of net worth
- settlement releases unfilled resting buy cash
- player sells consume virtual bid depth; unfilled sell shares remain sellable
- retail, news, quant, and whale pressure logic was split into focused engines
- `updateTick` now returns structured `TickResult` traces
- whale trades are executed and logged with owner, intention, fill, price, and stock
- the headless runner prints cap class, market cap, liquidity, effective depth, fills, resting orders, whale fills, and compact trace rows

The third implementation pass added a playable command-line access point:

- `npm run play` starts an interactive CLI game session
- optional seed can be passed after `--`, for example `npm run play -- my-seed`
- CLI commands expose fund state, market table, stock detail, portfolio, news, event log, per-stock trace rows, buy, sell, next tick, and multi-tick advance
- scripted stdin is supported for smoke tests and repeatable command sequences
- debug commands can edit cash and portfolio state for scenario setup

The fourth implementation pass fixed early execution exploits found through CLI play:

- tiny buys no longer jump to the next virtual price level
- execution price now interpolates by how much of a depth level was actually consumed
- limit-down sells require actual buy queue liquidity
- limit-up buys require actual sell queue liquidity
- selling into a limit-up board consumes the existing buy queue instead of replacing it
- buying into a limit-down board consumes the existing sell queue
- Quant Knife now starts with inventory and can repeatedly attack visible pumps, overextended names, and weak boards
- board breaks are classified as `brokenBoard` when a previous sealed/weak board is hit by strong sell pressure, even if the resulting price falls below the attacking-limit-up zone

The fifth implementation pass moderated excessive volatility around large orders and sealed boards:

- fixed stale-depth execution where whales could sell against the pre-buy depth ladder after the player had already pushed price to limit-up
- rebuilt market depth after player execution before whale execution
- stopped double-counting filled notional as full residual price pressure
- made only leftover/resting order footprint contribute residual player pressure after execution
- reduced whale residual pressure contribution after their fills, since the execution already moved price through depth
- made unfilled buy interest at limit-up become board support before whales can attack it
- changed limit-up depth so sell orders eat the buy queue at the limit price first
- added immediate retail/sentiment transition effects when a board seals, weakens, or breaks

The sixth and seventh implementation passes made opposition and momentum less mechanical:

- whales now act on paced, two-sided archetype strategies instead of every tick
- quants now fire in bursts and consider valuation/washout context
- derived EPS, net profit, growth, fair PE, live PE, and live market cap now exist for every stock
- fundamental pressure and valuation-sensitive depth now counter overextended rallies and support quality washouts
- retail emotion mean-reverts, and greed offsets fear so small dips do not instantly become panic
- panic-state detection now requires real drawdown context
- CLI stock detail and `whales` command expose the new balancing signals

The eighth implementation pass made other traders more portfolio-aware:

- whales now track average cost, realized P&L, unrealized P&L, and net worth
- whale buying updates weighted average cost, while selling realizes gains or losses
- whale strategy now checks position P&L before selling:
  - profitable positions are more likely to be sold into heat, greed, boards, or player demand
  - losing positions are less likely to be dumped unless fundamentals/board risk justify cutting
  - order slices shrink when whales are exiting at a loss
- the CLI `whales` view now shows P&L plus up to three marked positions with average cost and P&L percentage
- fundamentals now digest periodically instead of staying frozen:
  - every fifth settlement, EPS, profit growth, financial health, and fair PE drift from sector context and deterministic firm-level shocks
  - notable updates create sparse `fundamentalDigest` events
- filled player trades now leave a small visible footprint in pressure, so a huge dump into a queue can weaken sentiment/board strength without double-counting the full execution as another price-moving order

The ninth implementation pass stepped back from feature work and added balance-oriented project organization:

- added `docs/ROADMAP.md` as the short current-development map
- added shared CLI formatting helpers in `src/sim/format.ts`
- added `src/sim/balanceProbe.ts`
- added `npm run balance`
- balance probes now summarize:
  - min/max stock returns across seeds
  - panic, upside-board, and limit-down tick counts
  - whale trade count and average whale P&L
  - worst stock paths with PE/fair PE
  - average whale marks by actor
- the first probe shows the next tuning target clearly: distressed property/biotech paths still dominate panic and limit-down counts, while natural upside-board attempts are too rare in no-player runs

The tenth implementation pass started the market-breadth and explainability layer:

- added `src/simulation/shrimpCollectiveEngine.ts`
- added explicit whale campaign state:
  - accumulate
  - shakeout
  - mark-up
  - distribute
  - campaign target, timing, inventory goal, and note
- North Tower, Everbright, and Black Shoal can now run multi-step small/mid-cap campaigns instead of only one-off reactions
- split retail herd behavior into quieter baseline flow plus bursty collective behavior:
  - story/board-chasing speculation
  - washout dip buying
  - panic supply with fatigue
  - distressed rescue bids after deep washouts
  - profit taking only when strength is actually crowded
- made sealed and limit-down queues act as buffers against residual pressure:
  - a sealed limit-up buy queue now absorbs opposing pressure before price can fall away from the board
  - a limit-down sell queue now resists residual rescue pressure until bids are large enough
  - board queues now decay or rebuild according to net pressure instead of only accumulating one way
- made overnight settlement cool panic faster after undervalued washouts
- reduced stale quant/fundamental-style selling loops so bad fundamentals remain a valuation anchor, not a fresh shock every tick
- added `HeatCauseTrace` to structured stock traces
- stock trace output now includes top heat cause
- CLI stock detail now shows recent heat causes with source, heat/sentiment/attention deltas, buy/sell pressure, and note
- added trace assertions for player and market heat-cause output

The eleventh implementation pass made the market more sensitive to history and less smooth:

- added `src/simulation/marketMemory.ts`
- derived 1/3/5-day returns, streaks, volatility, drawdown from 10-day high, MA5 deviation, recent limit-up/limit-down days, board breaks, and last-tick move
- rebuilt initial daily candles to be mixed and noisy while ending exactly at the live previous close
- changed whale attention so each active whale ranks the whole market before acting, instead of every stock independently asking every whale
- added four more whale actors using existing archetypes:
  - Copper Gate Raiders
  - Jade Mountain Themes
  - Cedar Basin Value
  - Harbor Stabilization Desk
- fed market memory into whales, quants, shrimp cohorts, price cascades, fundamental pressure, and settlement
- added daily deterministic circumstance shocks and `marketCircumstance` events
- made repeated limit-down histories develop stronger exhaustion/floor bids so cascades can be violent without becoming a permanent conveyor belt
- added regression tests for mixed initial K-lines, market memory, history-aware whale exits, and Red River Lithium avoiding a 20-day up-only staircase
- expanded validation from 33 to 37 passing tests

The game concept is a 30-day deterministic stock market tactics simulator inspired by Chinese A-share market mechanics. The strongest design pillar is not realistic finance accuracy, but readable market behavior: player action, news, retail herds, whales, quants, liquidity, limit-up boards, and regulator heat should interact in ways the player can learn and exploit.

Immediate development direction: build the simulation core first, with deterministic tests and a minimal command-line or headless harness before investing in UI and graphics.

## Product Pillars

1. Limit-up and limit-down boards are the central drama.
2. T+1 inventory locking makes commitment and exit planning matter.
3. Retail, whales, quants, news, liquidity, and heat react to the same visible market state.
4. The event log must explain major market moves so outcomes feel legible.
5. Fictional content only: fictional stocks, fictional news, fictional institutions, fictional actors.
6. The final score should distinguish liquid realized gains from fragile paper wealth.

## Implementation Priority

### Phase 0: Repository Foundation

Priority: do first.

Goal: create a clean TypeScript project that can run deterministic simulations without UI.

Deliverables:

- `package.json`, TypeScript config, test runner, lint/format basics.
- Source folders matching the spec:
  - `src/game`
  - `src/simulation`
  - `src/player`
  - `src/content`
  - `src/ui` later
- Seeded RNG utility.
- Shared domain types.
- A headless simulation harness that can run one day or a full 30-day run from a seed.

Why first: every later system needs deterministic state updates, repeatable balancing, and a stable module layout.

### Phase 1: Core State, Content, and Basic Tick Loop

Priority: do immediately after foundation.

Goal: make the market advance through phases and ticks with static content.

Deliverables:

- `GameState`, `MarketState`, `SectorState`, `Stock`, `PlayerFund`, `Position`, `Order`, `NewsItem`, `Whale`.
- Initial 8 fictional stocks covering the required archetypes.
- Initial sectors.
- Initial whales with archetypes.
- Basic `createInitialGame(seed)` function.
- Phase transitions:
  - pre-market
  - opening auction
  - intraday
  - closing auction
  - settlement
  - ended
- Event log infrastructure.

Keep simple at this stage:

- No advanced whale strategy yet.
- No polished UI.
- No complex charts.

### Phase 2: Price, Liquidity, Board, and Portfolio Mechanics

Priority: core gameplay.

Goal: make stocks move and make trading consequences real.

Deliverables:

- Pressure model:
  - player pressure
  - retail pressure placeholder
  - whale pressure placeholder
  - quant pressure placeholder
  - institution/noise placeholders
- Price clamping by board type:
  - main board 10%
  - growth board 20%
  - ST board 5%
- Limit-up/limit-down state machine.
- Buy queue, sell queue, board strength.
- Dynamic liquidity.
- Player market buy/sell.
- T+1 locked and sellable shares.
- Cash, average cost, realized P&L, unrealized P&L, net worth.
- Settlement unlock.

Acceptance target:

- A headless run can execute 30 days without invalid prices, negative shares, or broken cash accounting.
- A player buy can help push a small-cap stock toward limit-up.
- T+1 prevents same-day exit of newly bought shares.

### Phase 3: Retail Herd and News

Priority: high.

Goal: make market behavior reactive and readable.

Deliverables:

- Retail profile updates by board state, price movement, news, greed, fear, attention, and cost pain.
- News generator with a smaller initial template set, then expansion toward 50 templates.
- News affects sentiment, attention, fear, greed, sector momentum, and heat risk.
- Active/expired news lifecycle.
- Event log messages for major retail/news reactions.

Start with:

- 15-20 news templates.
- Expand to 50 after the core loop feels good.

### Phase 4: Quants, Whales, and Heat

Priority: high, after basic price/retail behavior is stable.

Goal: give the market adversarial intelligence.

Deliverables:

- Quant pressure based on momentum, overextension, weak boards, news surprise, and player visibility.
- Individually simulated whales:
  - Pump Lord
  - Quant Knife
  - Value Wall
  - Rescue Whale
  - Bagholder Whale
- Whale intention update and pressure generation.
- Account heat and stock heat.
- Regulator events:
  - warning
  - inquiry letter
  - rumor clarification
  - trading halt
  - account restriction
  - investigation

Balance principle:

- Heat should punish obvious manipulation, not profitable ordinary trading.

### Phase 5: Influence Actions and Bear Contracts

Priority: medium-high.

Goal: complete the player's tactical toolset.

Deliverables:

- Split buy.
- Hidden sell.
- Defend board.
- Pull support.
- Push rumor.
- Spread fear.
- Commission report.
- Buy bear contract.
- Action visibility and heat impact.
- Backfire and clarification risk for rumor/fear play.

Why after NPCs: influence actions only become interesting once retail, whales, quants, news, and heat can respond.

### Phase 6: Balancing, Simulation Tests, and Debug Tools

Priority: continuous, but formalize before UI.

Goal: make the game tunable.

Deliverables:

- Deterministic scenario tests.
- Invariant tests:
  - no negative cash unless explicitly allowed
  - no negative shares
  - prices never exceed board limits
  - settlement unlocks T+1 positions
  - halted stocks do not trade
- Debug summaries:
  - pressure breakdown
  - board state timeline
  - whale intentions
  - heat causes
  - event log
- Balance scripts that run many seeded simulations.

### Phase 7: Minimal UI

Priority: after simulation is fun in headless mode.

Goal: expose the working game without heavy art investment.

Deliverables:

- React app shell.
- Home page.
- Market page.
- Stock detail page.
- Portfolio page.
- News page.
- End screen.
- Simple DOM/SVG/canvas chart.
- LocalStorage save/load.

Design direction:

- Dense, tactical, table-forward interface.
- It should feel like an operator's trading terminal, not a marketing landing page.
- Use readable event logs and estimates instead of revealing exact hidden NPC internals.

### Phase 8: Visual Polish and Assets

Priority: wait.

Goal: improve atmosphere after gameplay clarity exists.

Potential assets:

- Fictional stock logos or small sector icons.
- Market regime background treatments.
- News source icons.
- Whale archetype portraits or silhouettes.
- Board state visual markers.
- End-screen grade badge art.

Asset guidance:

- Assets should be placed under `src/assets/` or `public/assets/`, depending on the eventual framework setup.
- Keep all companies, logos, sources, and characters fictional.
- For the first playable version, icons can be simple code-native UI icons. Custom art should wait until the core game loop is proven.

## Features to Prioritize

- Deterministic RNG and replayable runs.
- Game state and phase machine.
- Price engine.
- Limit-up/limit-down board logic.
- T+1 portfolio accounting.
- Retail herd behavior.
- Event log.
- Heat and regulator consequences.
- Whale archetypes with distinct behavior.
- News/modifier system.
- Liquidity risk.

## Features to Wait On

- Polished React UI.
- Custom graphics.
- Advanced chart labeling.
- Full set of 50 news templates.
- Save/load beyond simple LocalStorage.
- Detailed end-screen analytics.
- Rich animation.
- Sound.
- Tutorial/onboarding.
- Mobile-specific layout polish.

## Features to Cut Directly

These should not be built unless the design direction changes significantly:

- Real companies, real political names, real agencies, or real public figures.
- Real-money mechanics.
- Multiplayer.
- Backend economy.
- Full exchange-grade order book.
- Full accounting statement simulation.
- Realistic options/derivatives.
- Complex technical indicators as core NPC logic.
- Exact legal/regulatory simulation.
- Live market data.
- User-generated rumors/news in a way that resembles real-world manipulation.

## Proposed First Code Milestone

Milestone name: Headless Market Kernel.

Target outcome:

- Run `npm test` and `npm run sim` locally.
- Generate a seeded 8-stock market.
- Advance through at least one full trading day.
- Process simple player market buys and sells.
- Clamp prices to daily limits.
- Update board states.
- Apply T+1 inventory locking and settlement unlock.
- Print an event log summary.

Suggested first file set:

- `package.json`
- `tsconfig.json`
- `src/game/config.ts`
- `src/game/types.ts`
- `src/game/rng.ts`
- `src/content/sectors.ts`
- `src/content/stocks.ts`
- `src/content/whales.ts`
- `src/game/createInitialGame.ts`
- `src/player/actions.ts`
- `src/player/portfolio.ts`
- `src/simulation/priceEngine.ts`
- `src/simulation/boardEngine.ts`
- `src/simulation/tick.ts`
- `src/simulation/settlement.ts`
- `src/sim/runHeadless.ts`
- `src/simulation/*.test.ts`

## Current Risks

- The design is broad; building all mechanics at once would make balancing impossible.
- If the UI is built too early, it may hard-code assumptions before the simulation stabilizes.
- Whale and quant behavior can become opaque unless every major move creates readable event log entries.
- Heat can feel unfair if the player cannot infer why it rose.
- Limit-up boards can dominate the game unless exits and liquidity risk are modeled early.

## Completed In First Implementation Pass

- Initialized the TypeScript project.
- Added `npm run sim`, `npm test`, and `npm run typecheck`.
- Created the starting 8-stock fictional A-share-inspired market.
- Created 5 initial whale archetypes.
- Added a small opening news set.
- Implemented market buy and market sell.
- Implemented T+1 share locking and settlement unlock.
- Implemented daily price limits by board type.
- Implemented basic limit-up/limit-down board states.
- Implemented event logging for phase changes, trades, board changes, and settlement.
- Added tests for RNG determinism, initial state validity, price-limit invariants, T+1 behavior, and deterministic action paths.

## Completed In Second Implementation Pass

- Added `marketDepth.ts` for virtual bid/ask depth, cap classes, effective depth, and depth-consuming executions.
- Added focused pressure engines:
  - `retailEngine.ts`
  - `newsEngine.ts`
  - `quantEngine.ts`
  - `whaleEngine.ts`
- Reworked player market buys into resting visible buy orders:
  - new buy interest reserves cash
  - fills consume ask depth
  - unfilled cash remains in `player.activeOrders`
  - resting buy orders expire after 5 ticks unless held around limit-up board support
  - settlement releases remaining reserved cash
- Reworked the tick pipeline so execution fills can move price before residual pressure is applied.
- Added structured `TickResult`/`StockTickTrace` output for scenario tests and balancing.
- Added scenario tooling in `scenarioTools.ts`.
- Added cap-impact, partial-fill, resting-order, whale-response, weak-board, and trace-richness tests.
- Added `.gitignore` for generated dependency/build artifacts.

## Completed In Third Implementation Pass

- Added `src/sim/playCli.ts`.
- Added `npm run play`.
- Implemented CLI commands:
  - `home` / `status`
  - `market`
  - `stock STOCK_ID`
  - `portfolio`
  - `news`
  - `events [N]`
  - `trace STOCK_ID [N]`
  - `next`
  - `advance N`
  - `buy STOCK_ID AMOUNT`
  - `sell STOCK_ID SHARES`
  - `help`
  - `quit`
- Market display now shows cap class, price, change, board state, effective depth, attention, sentiment, and heat.
- Stock detail shows liquidity/depth, board queues, retail profile, quant/institution presence, position, resting orders, and latest trace pressure.
- Tick summaries show player fills, notable stock movement, whale trades, and new events.
- CLI smoke-tested with piped commands.
- Added CLI debug commands:
  - `debug cash AMOUNT`
  - `debug addcash AMOUNT`
  - `debug pos STOCK TOTAL [SELLABLE] [LOCKED] [AVG]`
  - `debug addpos STOCK SHARES [AVG]`
  - `debug unlock STOCK|all`
  - `debug clearpos STOCK`

## Completed In Fourth Implementation Pass

- Fixed virtual-depth execution so small orders do not move to the next price level by default.
- Tightened locked-board liquidity:
  - no sell fill at limit-down without buy queue
  - no buy fill at limit-up without sell queue
  - queue liquidity is consumed by opposing fills
- Added Quant Knife inventory and attack behavior so opposition does not vanish after the opening reactions.
- Added regression tests for:
  - tiny buys not walking price levels
  - no limit-down selling without buy queue
  - no limit-up buying without sellers
  - limit-up buy queue consumption
  - continued Quant Knife opposition after a visible pump

## Completed In Fifth Implementation Pass

- Rebalanced execution/residual pressure interaction so large orders do not move price twice.
- Rebuilt post-player depth before whale execution so whales react to the current board state instead of stale pre-player depth.
- Made sealed-board queue support materially stabilize the board:
  - moderate sells execute at limit-up while queue remains
  - board faith/greed increase on a seal
  - fear/panic pressure falls on a clean seal
- Added a sealed-board stability regression test.

## Completed In Sixth Implementation Pass

- Reworked whale behavior from every-tick directional pressure into paced, strategy-specific actions.
- Added per-whale cooldown scheduling through `nextActionTick`, so a whale can act, wait, and re-enter later instead of exhausting cash or shares immediately.
- Made whale strategies two-sided:
  - North Tower Capital accumulates/pumps story stocks, but sells into heat, overextension, or sealed boards.
  - Silver Needle Quant attacks weak/crowded boards, but can scoop panic dips.
  - Stone Harbor Fund buys discounted large-cap quality and trims exuberance.
  - Blue Anchor Holdings defends large caps in weak markets and trims after recovery.
  - Everbright Ladder Desk can defend trapped boards but sells into player or retail demand.
- Added two new whale archetypes:
  - Red Kite Rotation, a sector rotator that follows hot sectors and exits when momentum or heat turns.
  - Black Shoal Partners, a liquidity vulture that scoops panic liquidity and sells rebounds.
- Changed quant pressure to be episodic instead of guaranteed every tick. Quants now burst on strong signals, weak boards, visible player action, or deterministic intermittent activity.
- Added a CLI `whales` / `w` command showing whale archetype, cash, inventory value, current intent, target, cooldown, and strategy note.
- Updated regression coverage so tests assert paced whale behavior and two-sided North Tower participation after a visible player action.

## Completed In Seventh Implementation Pass

- Added first-class derived fundamentals:
  - shares outstanding
  - earnings per share
  - net profit
  - profit growth estimate
  - fair PE
  - live PE/market-cap updates as price changes
- Added `fundamentalEngine.ts` so valuation, profit yield, financial health, and panic/mania context contribute explicit buy/sell pressure.
- Added valuation-sensitive depth:
  - undervalued stocks get more bid depth and less eager ask depth
  - overvalued stocks get more ask depth and less eager bid depth
- Reduced runaway retail momentum:
  - normal retail fear/greed now mean-reverts instead of saturating from repeated small moves
  - greed now offsets fear/panic selling in retail pressure
  - dip buyers provide support after material drops, especially in healthier stocks
- Tightened panic-state detection:
  - shallow 1% dips no longer become panic just because sell pressure is larger than buy pressure
  - panic now requires a material drawdown plus fear/sell imbalance, or a severe drawdown
  - attacking-limit-up only applies near the actual upper part of the daily range
- Reset stale momentum at settlement and added overnight cooling for greed, fear, panic sellers, board faith, attention, sentiment, and heat.
- Made quant signals more valuation-aware and less momentum-deterministic.
- Made whale orders more valuation-aware and sliced:
  - whales buy dips only when price/quality context supports it
  - whales sell into overextension/heat with smaller order slices
  - whales are less likely to dump aggressively into already-panicked boards unless valuation justifies it
- CLI stock detail now displays PE, fair PE, net profit, growth, and financial health.
- Added regression coverage for panic threshold, fundamental pressure, no-player momentum cooling, and updated sealed-board/resting-order expectations.

## Completed In Eighth Implementation Pass

- Added whale portfolio accounting:
  - weighted average cost by stock
  - realized P&L
  - unrealized P&L
  - marked net worth
- Whale trades now update cost basis and P&L instead of only cash/shares.
- Whale strategy now uses position P&L:
  - profitable positions can be sold into heat, greed, sealed boards, or visible player demand
  - losing positions are less likely to be dumped unless stop-loss/fundamental risk is severe
  - sell order size is reduced when a whale is exiting a loss
- Added periodic fundamentals digestion at settlement:
  - every fifth day, EPS, profit growth, fair PE, and financial health drift deterministically
  - significant changes create sparse `fundamentalDigest` events
  - fundamentals remain a valuation anchor between reports rather than a fresh daily news shock
- Added a small executed-player-trade footprint to pressure so huge filled buys/sells can affect board strength and sentiment without being counted as a second full execution.
- The CLI `whales` command now shows P&L, marked inventory, position average costs, and per-position P&L percentage.
- Added regression coverage for whale accounting, loss-aware whale selling, and fundamentals digestion.

## Completed In Ninth Implementation Pass

- Added [docs/ROADMAP.md](docs/ROADMAP.md) to separate current development direction from the long historical dev log.
- Added `src/sim/format.ts` for shared CLI/report formatting.
- Added `src/sim/balanceProbe.ts`.
- Added `npm run balance`.
- The balance probe reports:
  - seed-level min/max returns
  - panic, upside-board, and limit-down tick counts
  - whale trade count
  - whale P&L
  - fundamental digest count
  - worst stock paths
  - average whale marks by actor
- Reordered the practical next objective: before split/hidden execution actions, tune market breadth and add explainability traces.

## Completed In Tenth Implementation Pass

- Added a contained shrimp collective engine for bursty crowd behavior.
- Added whale campaign phases for accumulation, shakeout, mark-up, and distribution.
- Added campaign metadata to whale state so multi-step tactics can persist across ticks.
- Added market breadth tuning:
  - less always-on crowd chasing
  - less repeated panic selling once valuation becomes washed out
  - speculative rescue bids after deep panic/limit-down conditions
  - rare natural board-chasing bursts in high-attention names
- Fixed residual board pressure so large queues matter:
  - sealed limit-up queues buffer residual sell pressure
  - limit-down sell queues resist residual buy pressure
  - queue state decays/rebuilds from net pressure instead of being overwritten
- Added washout-aware overnight emotional cooling.
- Added heat-cause traces to `StockTickTrace`.
- Added top heat cause to `trace STOCK_ID [N]`.
- Added detailed heat-cause display to `stock STOCK_ID`.
- Extended regression coverage for heat-cause traces.

Verification:

- `npm run typecheck` passes.
- `npm test` passes with 24 tests.
- `npm run sim` runs a seeded one-day demo and prints market cap, depth, fill, resting-order, whale-fill, and event summaries.
- `npm run play -- smoke-seed` works interactively and with piped command scripts.
- `npm run play -- bugfix-smoke` verifies tiny buy behavior through the CLI.
- `npm run play -- debug-smoke` verifies debug cash/position commands through the CLI.
- `npm run play -- whale-strategy-smoke` verifies the CLI whale roster display through a piped command script.
- `npm run play -- fundamentals-smoke` verifies CLI fundamentals display and early-tick market output.
- `npm run play -- pnl-smoke` verifies CLI whale P&L/position display.
- `npm run balance` runs the multi-seed balance probe.
- Latest `npm run balance` average across 8 seeds / 10 days:
  - min return: -55.7%
  - max return: 60.4%
  - panic ticks: 206.8
  - upside-board ticks: 6.1
  - limit-down ticks: 208.1
  - whale trades: 202.8
- `npx tsx` balancing probes confirm shallow dips no longer enter panic and a 30-day no-player run cools heat/fear instead of chaining permanent limit boards.
- A 1000M repeated-seal then 60M-share dump probe confirms large queues can absorb only available liquidity, while unfilled dump size still leaves board/sentiment stress.
- `npm run play -- explain-smoke` confirms CLI heat-cause and trace output render after an intraday tick.

Known tooling note:

- `npm install` reported moderate audit warnings from the development dependency tree. No production runtime dependency has been added. Do not run forced audit upgrades until the project has a stronger dependency policy.

## Next Step

Objective: Smarter Opposition And Player Tools.

1. Make whale campaigns more outcome-aware:
   - trapped whales should not repeatedly lose money unless they are intentionally defending inventory
   - liquidity vultures should more clearly buy deep panic and harvest rebounds
   - campaign phase should be more visible in event/trace output
2. Add player execution actions:
   - split buy
   - hidden sell
   - defend board
   - pull support
3. Keep balance probing:
   - Golden Roof is still the recurring weak path
   - upside board attempts now exist but remain sparse in several no-player seeds
   - whale aggregate P&L is still too negative in passive runs
4. Start a larger news-template set once the player action layer is testable.

Do not start UI work yet.
