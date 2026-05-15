# Market Participant Behavior Dossier

This document is intentionally detailed. Its job is to make the current simulation explainable enough that future mechanics, especially news, patterns, stock options, whale strategy variants, and shrimp strategy variants, can plug in without guessing what the current actors already see.

## 1. Runtime Loop

The runtime order lives in `src/simulation/tick.ts`.

The phase loop is:

1. `preMarket`: pause before trading; advancing starts the opening auction.
2. `openingAuction`: advancing runs `runOpeningAuction(game)` and then enters intraday trading. There is no player participation in the opening auction yet.
3. `intraday`: each tick processes every active stock through the full participant stack.
4. `closingAuction`: currently processes one normal market tick, then immediately settles. This is a closing tick, not a separate call auction model.
5. `settlement`: closes the day, syncs candles, unlocks T+1 shares, clears resting player buy cash, decays news, may digest fundamentals, marks whales, and prepares next-day state.

The per-stock intraday pipeline is:

1. Retail emotion updates from current board and price state.
2. Liquidity is recalculated.
3. News, retail, fundamental, shrimp collective, quant, and institution pressure are read.
4. A first market depth is built.
5. Player orders execute or rest in the book.
6. Quant pressure is recalculated with player visibility.
7. A second depth is built after player pressure.
8. Whales select opportunities, possibly trade, and update accounting.
9. All pressures are aggregated.
10. Ambient tape prints passive and matched volume.
11. Residual pressure moves price.
12. Board state, heat causes, chart prints, candles, whale marks, and player net worth update.

The design invariant is: participant engines produce pressure or state deltas; depth, price, and board engines consume the aggregate.

After each processed market tick, `marketBreadthEngine.ts` rebuilds sector and market state from actual tape behavior. Sector momentum, sector attention, sector sentiment, market sentiment, market liquidity, market volatility, and market regime now react to breadth, board clusters, stress, heat, and constituent moves.

## 2. Shared State Surfaces

Most decisions are built from these surfaces:

- Stock tape: price, previous close, open, high, low, momentum, turnover, volume, current liquidity, flow memory, liquidity stress, shock memory, and last print sign.
- Board state: loose, attacking limit-up, weak seal, sealed limit-up, broken board, panic, limit-down, buy queue, sell queue, and board strength.
- Valuation: PE, fair PE, EPS, financial health, valuation gap, and profit yield.
- Retail emotion: greed, fear, panic sellers, dip buyers, gamblers, bagholders, momentum, attention, and board faith.
- Market memory: 1/3/5/10-day returns, streaks, green days, volatility, drawdown, moving-average deviation, recent limit events, board breaks, last tick move, opening gap, and open-to-now move.
- Formal stock options: market-cap class, liquidity tier, speculation tier, quality tier, valuation style, and behavior tags.

Stock options are now refreshed after price, valuation, heat, attention, opening-auction, and settlement changes. Before this pass they were derived only at stock creation, so a stock could become hot, distressed, or overvalued while still carrying stale tags.

### 2.1 Board Queue Ledger

Code: `src/simulation/boardQueueLedger.ts`

Raw buy/sell queue notional still exists because the UI, depth model, and traces need visible queue size. The ledger adds the missing explanation layer:

- `quality`: how sturdy the queue is, from soft crowd/noise flow to stronger player, whale, institution, fundamental, or opening imbalance.
- `dominantSource`: the largest visible source behind the current queue.
- `addedNotional` and `consumedNotional`: how much queue was built and how much opposing flow ate through it.
- `lockedTicks` and `openedTicks`: whether the queue has been holding a flat board or repeatedly failing to hold.

How it acts:

- Board engine additions, consumption, and passive decay now go through the ledger.
- Opening auction flat boards seed queues as `opening` queues.
- Player upper-board support joins the ledger as `player` queue.
- Depth fills consume the ledger instead of subtracting anonymous raw queue.
- Price-engine queue pins use queue quality, so a large low-quality crowd queue is less sturdy than the same notional built by stronger hands.

Why it matters:

- This replaces a contrived anti-ping-pong memory with a market-native explanation: boards stay flat when the actual locked queue has enough size and quality; they open when opposing flow consumes or overwhelms it.
- Continuous flat boards remain possible because locked ticks slightly reinforce quality instead of forcing reversal.
- T-board behavior can later be modeled as queue opening/partial refill rather than random price spikes away from the limit.

## 3. Opening Auction

Code: `src/simulation/openingAuctionEngine.ts`

Who acts:

- No named individual actor yet.
- The auction is currently a market-wide opening imbalance model.

What it sees:

- Previous completed candle.
- Recent market memory.
- Sector momentum.
- Closing board state.
- Current valuation gap.
- Shared overrun fatigue and washout attention signals.

How it acts:

- Day 1 does nothing; the listed starting price is the open because there is no in-run prior day.
- From day 2 onward, each unhalted stock receives a gap percentage.
- The gap is made from random auction noise, overnight mood, prior close continuation, board carry, repeated limit-down relief, overrun fatigue, washout attention, and rich valuation fatigue.
- The opening price is clamped only by the real daily upper/lower limit, not by an extra arbitrary auction-gap cap.
- Heated prior limit-up boards can open at the actual upper limit; prior limit-down boards can also reopen flat at the lower limit.
- The current transition runs a few internal indicative auction ticks before uncrossing, leaving room for later indicative-price/order-book implementation without changing the player flow yet.
- The auction sets price, open, high, low, micro-price, momentum, flow/shock memory, valuation, stock options, opening chart print, and candle open.
- A large enough gap emits an `openingAuction` event.

Revision note:

- Opening auction RNG is now explicitly seeded as `opening-auction`, not coupled to `daily-circumstance`.
- The old compatibility draw was removed because it preserved an old random sequence at the cost of explainability.

Current limitation:

- There is no indicative open, call book, player auction order, or uncrossing calculation yet.

## 4. Overnight Circumstance And Settlement

Code: `src/simulation/settlement.ts`

Who acts:

- Settlement is the daily state transition, not an individual participant.

What it sees:

- Closing price and open-to-close move.
- Closing board state.
- Market memory before the new day starts.
- Current valuation.
- Sector sentiment and momentum.
- Shared overrun fatigue and washout attention signals.

How it acts:

- Syncs the finished candle.
- Sets close as the next previous close.
- Resets intraday high/low/open, board queues, board state, microstructure memory, volume, turnover, and momentum.
- Slowly moves average holder cost toward the close.
- Every five days, may change profit growth, EPS, financial health, and fair PE.
- Applies overnight circumstance to attention, sentiment, heat, liquidity, greed, dip buyers, fear, and panic sellers.
- Starts the next candle and chart at tick 0.

Revision note:

- Overnight circumstance numbers now live in `marketBehavior.dailyCircumstance`.
- Overrun fatigue and washout attention now come from `marketSignals.ts`, shared by settlement and opening auction.

Current limitation:

- Closing auction still needs its own model.

## 5. Retail Profile

Code: `src/simulation/retailEngine.ts`

Who acts:

- Aggregate emotional retail climate for a stock.

What it sees:

- Board state, day change, momentum, heat, sentiment, financial health, and existing retail emotion.

How state updates:

- Sealed limit-up usually raises greed, attention, and board faith while lowering fear, but high trauma weakens that boost.
- Weak seal raises both greed and fear while lowering board faith.
- Broken board and panic raise fear and panic sellers, lower greed, and damage board faith.
- Limit-down strongly raises fear and panic sellers.
- Loose tape slowly mean-reverts toward neutral greed/fear anchors, adjusted by trend and deep-loss pressure.

How it produces pressure:

- Buy pressure comes from effective greed, attention, board faith, positive momentum, dip demand, and positive news.
- Sell pressure comes from effective fear, effective panic, negative momentum, and negative news.
- High greed/heat multiplies buy pressure; high fear/heat multiplies sell pressure.

Cleanup target:

- Retail coefficients should move into `marketBehavior.retail`.

## 6. Shrimp Cohorts

Code:

- Constitution: `src/config/shrimpCohortConstitution.json`
- Initial creation: `src/content/shrimpCohorts.ts`
- Intraday behavior: `src/simulation/shrimpCollectiveEngine.ts`

Who acts:

- `boardChaser`
- `momentumScalper`
- `dipBuyer`
- `panicCutter`
- `valueHolder`
- `noiseTrader`

What each cohort owns:

- Capital, inventory notional, conviction, activity, risk appetite, order size, and flow memory.

How the constitution works:

- Initial mix is config-driven.
- Tilts are speculative, value, trapped, and momentum.
- Each strategy maps tilts plus stock features into weight, conviction, activity, risk appetite, order size, and starting inventory ratio.
- Capital is normalized across cohorts.

Shared intraday context:

- Day move, open move, last-tick move, opening gap, open-to-now move, prior hot board, failed follow-through, fight-back, no-bid slide, support failure, panic cascade, story score, washout score, fear score, board-chase score, disagreement score, limit progress, resistance, height fear, gap-fade risk, post-crash aftershock, returns, streaks, board breaks, and limit-down count.

Board chasers:

- See story strength, board faith, greed, heat, prior hot boards, limit-up magnet, failed follow-through, height fear, and post-crash aftershock.
- Buy follow-through and board attempts.
- Sell failed follow-through, support failure, panic cascade, tall multi-day runs, and gap-fade risk.

Momentum scalpers:

- See momentum, last-tick move, flow memory, stress, panic cascade, limit-up magnet, height fear, and disagreement.
- Buy positive momentum/flow.
- Sell negative momentum/flow, cascades, down streaks, and height fear.

Dip buyers:

- See washout score, valuation discount, fight-back, stress, failed hot boards, and falling-knife risk.
- Buy weakness when discount or visible absorption exists.
- Brake hard during panic cascades without fight-back.
- Sell only on extreme no-bid conditions.

Panic cutters:

- See fear, panic sellers, no-bid slide, support failure, panic cascade, down streaks, board breaks, negative ticks, and negative news.
- Mostly sell.
- Buy only lightly on fight-back or extreme undervaluation.

Value holders:

- See valuation, PE, health, large-cap status, drawdown, fight-back, height fear, and gap-fade risk.
- Buy discounted healthier stocks.
- Sell rich valuation, extended day moves, height fear, and weak health.
- Large caps make them slower and more patient.

Noise traders:

- See attention, stress, panic cascade, limit-up magnet, and day-change mean reversion.
- Flip small two-way orders from random lean plus mean reversion.

How shrimp orders become pressure:

- Intent uses active capital, conviction, risk appetite, strategy scores, and urgency.
- Intent is capped by capital or inventory.
- `quantizeSmallOrderBurst` converts intent into many small orders with order size, urgency, clustering, and realized-intent caps.
- Capital, inventory, and flow memory update after each burst.

Crowd narrative overlay:

- Creates synchronous theme bursts, washout bids, panic bursts, failed-board debates, height-fear supply, profit-taking, and greed/fear disagreement.
- This layer is not dead legacy; it models broad crowd coordination that is bigger than a single cohort.

Cleanup target:

- Intraday shrimp strategy formulas should become a registry like whales: one module per strategy, each with its own config.

## 7. Player

Code: `src/player/actions.ts`

Who acts:

- The player, only when player actions are passed into the tick.

What the order system sees:

- Cash, positions, current depth, current price, upper limit, limit price, and active player orders.

How buys work:

- `marketBuy` reserves cash and creates visible resting buy interest.
- It immediately attempts execution against ask depth.
- Unfilled cash rests for configured ticks.
- Marketable resting interest adds pressure.
- Deep resting interest only matters if close enough to the visible book.
- At upper limit, eligible interest can join the buy queue.
- Expired unfilled cash returns to player cash.

How sells work:

- Sells immediately hit bid depth.
- Only sellable shares can be used, respecting T+1 locked shares.
- Filled sells add sell pressure and visibility.

How others see the player:

- Visibility affects quant pressure.
- Visibility contributes to whale opportunity scoring.
- Fills create execution shock and heat.

Cleanup target:

- Player buy styles should be explicit: aggressive buy, visible support buy, and hidden/passive buy.

## 8. Quant Engine

Code: `src/simulation/quantEngine.ts`

Who acts:

- Aggregate fast-money signal model.

What it sees:

- Momentum, news, valuation, health, weak boards, memory, opening-gap fade, staircase risk, limit-down fatigue, stop-loss risk, absorption, and player visibility.

How it acts:

- Builds a signed signal.
- Positive signal creates buy pressure; negative signal creates sell pressure.
- Small signals can still act through burst chance.
- Weak boards, high player visibility, or large signal magnitude force activity.

Behavior:

- Buys some healthy washouts.
- Fades overextension and staircase runs.
- Punishes weak boards and visible player interest.

Cleanup target:

- Move coefficients to `marketBehavior.quant` and expose named sub-signals in traces.

## 9. Fundamental Pressure

Code: `src/simulation/fundamentalEngine.ts`

Who acts:

- Broad valuation-sensitive capital.

What it sees:

- Valuation, financial health, market sentiment, board state, day change, retail panic/greed, drawdown, returns, streaks, and limit events.

How it acts:

- Buys undervaluation, profit yield, healthy panic/washout, and crash-floor conditions.
- Sells overvaluation, mania, fragile expensive stocks, crowded runs, large-cap overrun, and rich runners.
- Reduces sell supply after repeated limit-down capitulation when valuation is no longer rich.

Cleanup target:

- Move coefficients to `marketBehavior.fundamental`.

## 10. Institution Engine

Code: `src/simulation/institutionEngine.ts`

Who acts:

- Slower valuation and quality-sensitive institutional capital.

What it sees:

- Institution presence, financial health, valuation gap, 10-day return, MA deviation, and open-to-now move.

How it acts:

- Healthy names with institution presence receive bias buy pressure.
- Weak names receive bias sell pressure.
- Deep discount adds support, especially in healthy names.
- Rich valuation, strong 10-day runs, MA extension, and open-to-now extension add overrun supply.

Why separate from fundamentals:

- Fundamental pressure is broad valuation gravity; institution pressure depends on dedicated capital already present in the name.

## 11. Whale Engine

Code:

- Strategy and execution: `src/simulation/whaleEngine.ts`
- Accounting: `src/simulation/whaleAccounting.ts`
- Roster: `src/content/whales.ts`

Who acts:

- Named whales with cash, positions, average costs, net worth, aggression, patience, risk tolerance, heat tolerance, preferred caps, preferred sectors, cooldown, and archetype.

Shared whale perception:

- Sector/cap preference, position, PnL, valuation gap, day change, market memory, runner exhaustion, gap-fade risk, staircase risk, overextension, profitable exit, stop-loss risk, deep discount, panic dip, hot sector, fragile board, player visibility, and effective depth.

Opportunity arbitration:

- Each whale scores the current stock against every other active stock.
- Usually only the best opportunity is acted on.
- Near-best or compelling opportunities can still act probabilistically.
- Campaign whales stay committed to the campaign stock.

Shared campaign layer:

- Pump lord, bagholder whale, and liquidity vulture can start campaigns.
- Campaigns avoid large caps, very hot boards, sealed boards, and exhausted up streaks.
- Campaign phases are accumulate, shakeout, mark-up, and distribute.
- Accumulate buys below max entry.
- Shakeout may sell a small attack.
- Mark-up buys aggressively.
- Distribute sells into greed or board strength.

Shared risk layer:

- Before archetype logic, many whales can sell if runner exhaustion or gap-fade risk is high and the position is profitable or near flat.

Pump lord:

- Accumulates low-attention, low-heat story names.
- Pumps names with attention but tolerable heat/valuation.
- Dumps profitable or risky positions into high heat, sealed boards, overextension, or stop-loss risk.
- Can now dump crowded high-heat inventory when attention/greed/player visibility is high, even if the position is only near flat. This became more important after news stopped acting as direct price pressure.

Quant knife:

- Likes overextension, runner exhaustion, fragile boards, weak boards, player visibility, and cascades.
- Buys some healthy panic dips.
- Sells/attacks when profitable exits line up with fragility, heat, visibility, up streaks, runner exhaustion, or gap-fade risk.

Value wall:

- Buys deep discounts in financially healthy stocks when fear exists.
- Sells overextension, greed, or stop-loss risk.

Rescue whale:

- Only likes preferred-sector large caps.
- Defends weak markets, panic dips, bad momentum, or large drawdowns when valuation is not rich.
- Sells after recovery when momentum, greed, and valuation turn positive.

Bagholder whale:

- Defends weak seals if trapped, cashed up, and not in stop-loss risk.
- Dumps when near breakeven and greed, player visibility, or sealed boards provide exit liquidity.

Sector rotator:

- Buys preferred hot sectors when heat and valuation are tolerable and the run is not too old.
- Sells when sector cools, heat rises, momentum rolls, up streak extends, runner exhaustion appears, or stop-loss risk appears.

Liquidity vulture:

- Scoops panic liquidity in preferred small/mid sectors when valuation is not rich and flow is not totally broken.
- Sells rebounds into momentum, greed, player visibility, or stop-loss risk.

Opportunistic probe:

- Familiar whales can make small probes if the tape is interesting.
- They may trim rich/exhausted existing positions.
- They may buy acceptable valuation after gap-downs, drawdowns, or absorption.

Execution:

- Whale buys consume ask depth.
- Whale sells consume bid depth.
- Fills update execution price, whale cash, inventory, average cost, PnL, stock volume, turnover, heat, and events.

Cleanup target:

- The registry is formal, but archetype constants still belong in a `whaleStrategies` config keyed by archetype and intention.

## 12. Market Depth

Code: `src/simulation/marketDepth.ts`

Who acts:

- Not a participant; it is the book model every active order consumes.

What it sees:

- Current liquidity, cap class, float value, board limits, pressure hints, valuation, retail emotion, institution presence, board state, queue size, liquidity stress, and flow memory.

How it acts:

- Computes effective depth from current liquidity, cap multiplier, and float ceiling.
- Builds bid and ask notional from pressure skew, board modifiers, retail emotion, institution presence, valuation, stress, and flow memory.
- Creates price levels from current price to limit using tick size.
- Weights levels with deterministic pseudo-noise.
- Locked queues become first executable levels at the limit price.
- Fills at a locked limit consume the board queue ledger.

Important behavior:

- Limit-up stocks have scarce asks and buy queues.
- Limit-down stocks have scarce bids and sell queues.
- Stress and flow memory change book shape.

## 13. Ambient Tape

Code: `src/simulation/ambientTape.ts`

Who acts:

- Passive market churn not attributable to player or whale fills.

What it sees:

- Retail, shrimp, quant, institution, fundamental, news, and noise pressure; liquidity; cap class; attention; institution presence; market volatility.

How it acts:

- Builds passive flow from liquidity and market conditions.
- Adds matched flow from buy/sell overlap.
- Adds aggressive cross flow from imbalance.
- Applies deterministic churn.
- Caps notional by cap-class liquidity share.
- Adds volume and turnover, but does not directly set price.

Why it matters:

- It gives the tape volume when named fills are absent and increases gross flow in the price engine.

## 14. Price Engine

Code: `src/simulation/priceEngine.ts`

Who acts:

- The microstructure printer.

What it sees:

- Aggregated pressure, pressure breakdown, effective depth, player fills, whale fills, ambient matched notional, board limits/queues, queue ledger quality, cap class, microstructure memory, day change, open change, market memory, retail emotion, cost distribution, heat, valuation, and board state.

How it acts:

- Adds emotional noise scaled by volatility, heat, emotional extremes, and stress.
- Adjusts imbalance if a limit queue can absorb pressure.
- Converts player/whale fills into execution shock.
- Updates flow memory, shock memory, and liquidity stress.
- Builds directional ticks from net flow and memory.
- Adds reversion after intraday extension.
- Adds jitter from volatility, attention, stress, emotion, and gross flow.
- Adds battle impulses, cascade impulses, emotional breaks, and regime friction.
- Enforces queue pins near limit-up or limit-down using queue size and queue quality.
- Updates price, heat, attention, sentiment, retail emotion, valuation, and stock options.

Necessary pieces:

- Directional flow, depth, execution shock, queue pins, board limits, and tape memory are core.
- Cascades and emotional breaks are needed for non-linear behavior.

Cleanup target:

- Split into submodels: pressure aggregation, tape memory, directional print, battle impulse, cascade impulse, emotional break, regime friction, queue pin, and derived metrics.

## 15. Board Engine

Code: `src/simulation/boardEngine.ts`

Who acts:

- Converts price, queues, and pressure into board state.

What it sees:

- Price vs limits, buy/sell pressure, queues, queue ledger quality/source, retail emotion, cost distribution, heat, and market cap.

How it acts:

- At upper limit, net buy pressure grows the buy queue with source/quality accounting; net sell pressure consumes it and may build sell queue.
- At lower limit, net sell pressure grows the sell queue with source/quality accounting; net buy pressure consumes it and may build buy queue.
- Away from limits, queues decay and quality fades.
- Board strength is quality-adjusted buy queue relative to sell pressure and hidden exit risk.
- Locked boards pin price when the queue is large enough relative to liquidity and quality-adjusted opposing flow.
- A limit-down board does not print repeated intraday spikes unless opposing buy flow can actually overwhelm sell pressure plus queue buffer.
- A sealed limit-up board stays flat unless sell flow can actually overwhelm buy pressure plus queue buffer.
- Severe drops and fear snowball can create panic.
- Near upper limit creates attacking-limit-up.
- Strong queue and conviction create sealed-limit-up.
- Weaker queue creates weak seal.
- Failed seals become broken board.

Important behavior:

- A sealed board needs queue depth and buy conviction, not just price at limit.
- True flat boards are now allowed to stay flat; T-board behavior should come from the queue opening, not from random price jitter.
- The limit-down/limit-up ping-pong problem should now be diagnosed through queue ledger state: a hard lock is size plus quality; an opening board is consumed queue plus stronger opposite flow.

## 16. News

Code: `src/simulation/newsEngine.ts`

Who acts:

- News is an information source attached to market, sector, or stock scope.

What it sees:

- Scope, target, polarity, strength, credibility, remaining days, and heat impact.

How it acts:

- Applicable news contributes signed impact.
- News no longer injects generic buy/sell pressure directly.
- Impact changes actor inputs: stock attention, stock heat, stock sentiment, retail attention, news followers, greed, board faith, fear, panic sellers, and dip buyers.
- Retail, shrimp, and quant still read the signed impact as part of their own decision logic.
- Future whale and institution reactions should read the same impact/tags through explicit strategy hooks.

Cleanup target:

- News should eventually target stock option tags, whale strategy classes, and shrimp cohorts differently.

## 17. Market And Sector Breadth

Code: `src/simulation/marketBreadthEngine.ts`

Who acts:

- Breadth is not a trader. It is the market climate feedback loop.

What it sees:

- Constituent day moves.
- Advancer share.
- Hot-board share.
- Weak-board, panic, and limit-down share.
- Average stock sentiment, attention, heat, turnover ratio, and microstructure stress.

How sectors update:

- Sector sentiment follows constituent returns, advancer breadth, stock sentiment, hot-board clusters, and weak-board clusters.
- Sector attention follows constituent attention, heat, turnover, and board activity.
- Sector momentum follows return strength plus limit-up/limit-down board imbalance.

How market state updates:

- Market sentiment follows broad returns, breadth, board imbalance, and sector sentiment.
- Market liquidity improves with positive breadth and weakens with stress, panic share, and heat.
- Market volatility rises with absolute returns, stress, board activity, and heat.
- Market regime becomes bull, bear, or choppy from sentiment, sector momentum, limit-down share, and panic share.

Why this matters:

- Stock behavior now feeds the sector and market state that later ticks read.
- Sector attention/momentum is no longer just initial flavor text; it becomes a consequence of the tape.

## 18. What Was Revised In This Pass

Code changes:

- Added `src/simulation/marketSignals.ts`.
- Added `marketBehavior.memorySignals`.
- Added `marketBehavior.dailyCircumstance`.
- Removed the opening-auction compatibility RNG draw.
- Separated opening-auction RNG from daily-circumstance RNG.
- Added `refreshStockOptions(stock)`.
- Refreshed stock options after price/valuation updates, derived metric updates, opening auction gaps, settlement valuation, and overnight circumstance.
- Fixed stock option speculation thresholds to use config instead of literals.
- Added `src/simulation/marketBreadthEngine.ts`.
- Added `marketBehavior.marketBreadth`.
- Converted news from direct pressure into actor input modifiers.
- Added a pump-lord heat-exit gate for crowded manipulation risk.
- Added locked-board queue pinning to reduce unrealistic intraday spikes away from real limit queues.
- Added `src/simulation/boardQueueLedger.ts`.
- Added `marketBehavior.board.queueLedger`.
- Routed board-engine queue changes, depth queue consumption, player upper-board support, opening-auction flat-board queues, and settlement queue resets through the ledger.
- Added queue ledger fields to stock state and full tick traces.
- Added a regression test for repeated limit-down ticks staying pinned while a real sell queue holds.

Behavioral meaning:

- Opening auction is easier to reason about.
- Overnight setup is easier to tune.
- Stock option profiles are no longer stale.
- Shared memory signals now have one definition instead of duplicate settlement and auction coefficients.
- Market and sector climate now respond to realized breadth.
- Headlines now move the market through participants instead of generic price force.
- Limit-board stability is now explained by queue size, queue source, queue quality, and actual opposing flow instead of a hidden board-memory brake.

## 19. Revision Watch List

High confidence to keep:

- Separate opening auction phase.
- Whale opportunity arbitration before archetype actions.
- Shared whale campaign layer.
- Shrimp constitution config.
- Crowd narrative overlay plus cohort-level small orders.
- Board queue pinning and board-strength model.
- Microstructure memory.
- Locked-board queue pinning.
- Board queue ledger with source/quality accounting.

Needs next cleanup:

- Price engine submodel split.
- Shrimp intraday strategy registry and config.
- Whale archetype config.
- Retail config.
- Fundamental config.
- Closing auction model.
- Explicit player order styles.
- Trace output for named sub-signals, not only final pressure.
- News tag routing into stock options, shrimp strategies, institutions, and whale strategies.
- UI exposure for queue source/quality so the inspection surface can show why a board is locked or opening.

The next architecture goal is to make future information events ask formal questions:

- Does this stock have the `story-sensitive` tag?
- Is the whale strategy a campaign strategy, defensive strategy, or liquidity strategy?
- Which shrimp cohorts should receive the event?
- Should the event modify conviction, activity, risk appetite, or direct pressure?

That lets news and pattern mechanics target entities without pushing special cases into the price engine.
