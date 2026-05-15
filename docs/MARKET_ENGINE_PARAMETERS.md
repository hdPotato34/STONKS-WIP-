# Market Engine Parameter Map

This note records the consolidation pass over the market simulation knobs. The goal is to keep future mechanics explainable: new news, pattern, or entity reactions should plug into named parameters and dedicated engines instead of adding anonymous weights inside the tick loop.

## What Should Stay As Rules

- Board limits, tick duration, total days, starting cash, stock count, and heat caps are game rules. They live in `src/config/gameRules.json`.
- Unit conversions such as percent scale, price tick, minimum price, and board-lot size are shared market units. They live in `src/config/marketBehavior.json` under `units`.
- Market-cap bands are classification rules. They live in `marketBehavior.marketCap` and are shared by market depth, stock options, and board logic.

## What Was Moved To Behavior Config

- News actor-effect scaling. Direct generic news pressure is configured to zero; news impact now moves actor inputs.
- Event log retention.
- Market and sector breadth feedback.
- Shared memory signals for overrun fatigue and washout attention.
- Opening-auction gap generation and gap aftermath.
- Overnight daily circumstance setup.
- Player order visibility, heat, resting pressure, and expiry.
- Player and whale execution footprints after real fills.
- Heat-cause attribution weights used in tick traces.
- Institutional pressure thresholds and weights.
- Market-depth class multipliers, float-depth ceilings, level counts, and board book modifiers.
- Board transition thresholds for near-limit, panic, weak seal, and sealed board states.
- Locked-board queue pinning thresholds for flat limit boards and board opening.
- Board queue ledger quality, source-quality scores, decay penalties, consumption penalties, and quality-to-buffer scaling.
- Ambient tape passive flow, matched flow, churn, and cap-class volume caps.
- Whale minimum order sizes, event threshold, opportunity arbitration, cooldowns, and runner-exhaustion signal weights.
- Shrimp collective blend/cap parameters and small-order burst quantization.
- Initial shrimp cohort constitution in `src/config/shrimpCohortConstitution.json`.
- Stock option/profile derivation in `src/content/stockOptions.ts`, with thresholds in `marketBehavior.stockOptions`.

## Opening Auction Revision

The old code generated next-day opening gaps inside settlement. It worked, but it made `openingAuction` a label rather than a behavior phase. Opening price formation now lives in `src/simulation/openingAuctionEngine.ts` and runs when `openingAuction` transitions into intraday.

Settlement prepares overnight state: close, T+1 unlocks, resting order cleanup, fading heat, fundamental digest, and overnight circumstance. Opening auction sets the actual open/high/low/micro-price, opening chart print, candle open, and opening imbalance event.

Day 1 intentionally keeps the listed opening price. There is no prior in-run overnight auction yet.

Opening auction now has its own RNG seed. It no longer consumes a hidden daily-circumstance draw to preserve an old sequence. The old extra auction-gap cap has also been removed; the true daily board limit is the cap. The transition now emits internal indicative auction ticks before uncrossing so a later implementation can expose indicative price and book imbalance.

## Shrimp Constitution

Initial shrimp cohorts are not random magic anymore. The stock-specific cohort mix is built from named tilts:

- `speculative`: gamblers, board faith, stock attention.
- `value`: financial health, PE discount, institution presence.
- `trapped`: bagholders, panic sellers, loss distribution.
- `momentum`: retail momentum, quant presence, absolute momentum.

Each strategy seed has configurable weight, conviction, activity, risk appetite, order size, and inventory ratio. This keeps the constitution tunable while preserving the code's job: read features, apply named formulas, normalize capital.

## Whale Strategy Registry

Whale archetype order decisions route through `whaleStrategyRegistry` in `src/simulation/whaleEngine.ts`.

The central engine still owns shared context building, campaign handling, cooldowns, execution, and accounting. Each archetype handler owns its own buy/sell decision gates. This makes future archetypes additive and keeps shared mechanics out of individual strategy code.

## Stock Options

Stocks receive an explicit option/profile object:

- `marketCapClass`
- `liquidityTier`
- `speculationTier`
- `qualityTier`
- `valuationStyle`
- `behaviorTags`

This is not an options-derivatives system. It is a behavioral profile layer so future systems can ask clean questions like "is this a trapped-float story stock?" without reconstructing that from raw PE, attention, float, and retail fields every time.

The profile now refreshes after price-derived, valuation-derived, emotion-derived, opening-auction, and settlement changes. This matters because strategy code should see the stock's current behavior profile, not its day-zero label.

## Legacy Crowd Layer

The old `legacy` shrimp pressure was not dead code. It is now named `CrowdNarrativePressure` because it represents broad narrative surges: theme bursts, panic bursts, washout bids, post-board disagreement, height fear, and profit-taking waves.

It remains useful because individual cohorts produce granular small-order flow, while the narrative layer creates market-wide synchronous behavior. The blend between the two is configurable through `narrativePressureWeight` and `narrativeEffectWeight`.

## Board Queue Ledger

`src/simulation/boardQueueLedger.ts` now owns production queue mutation. Raw `buyQueue` and `sellQueue` remain as visible notional, but each side also carries source/quality accounting:

- source quality scores live in `marketBehavior.board.queueLedger.sourceQuality`;
- additions blend queue quality by notional;
- fills and opposing flow consume queue and reduce quality;
- passive decay lowers both queue notional and quality;
- repeated locked ticks can strengthen a real flat board slightly;
- repeated opening ticks weaken the queue.

This is the current answer to limit-up/limit-down ping-pong. A board should not reverse because of a hidden refractory rule. It should stay locked when the queue is large and sturdy, open when enough opposing flow consumes it, and only reverse if the new side builds its own credible queue.

## Numbers That Still Deserve Later Work

- `priceEngine.ts` still contains many microstructure coefficients. Most are doing real work, but they should be grouped into named models such as `directionalPrint`, `battleImpulse`, `cascadeImpulse`, `emotionalBreak`, and `queuePin`.
- Locked-board pinning and queue mutation are now centralized through `boardQueueLedger`, but the UI should expose queue quality/source and price traces should include named queue-pin/open causes.
- `shrimpCollectiveEngine.ts` still has strategy-specific intraday scoring formulas inline. The current pass moved constitution, shared burst, and cap mechanics; a later pass should make each cohort strategy a separate reaction module.
- `whaleEngine.ts` has a strategy registry now, but the handler constants should continue moving into archetype-specific config.
- `retailEngine.ts` and `fundamentalEngine.ts` still mix transition math with coefficients. They are smaller than the tick/whale/shrimp surfaces, so they are lower risk but still good candidates for follow-up extraction.

## Design Direction

Treat future information sources as pressure/reaction producers:

1. Build a context snapshot from price, memory, fundamentals, news, and pattern state.
2. Let each entity engine produce named pressure and state deltas.
3. Aggregate pressure in `tick.ts`.
4. Let price/depth/board engines consume the aggregate and emit traceable causes.

That keeps new mechanics additive: a future news-pattern system can add a producer module without reaching into whale, shrimp, or price internals.
