# Progress Notes

## What Exists

STONKS-WIP currently has a playable deterministic market core with both CLI and React inspection surfaces. The simulation advances through pre-market, opening auction, intraday trading, closing auction, and settlement across a 30-day run.

The market contains eight fictional stocks across tech, biotech, property, consumer, resources, finance, defense, and energy. Each stock tracks price, previous close, open/high/low, liquidity, turnover, volume, valuation, retail emotion, board queues, board state, cost distribution, shrimp cohorts, quant presence, institution presence, intraday chart points, and daily candles.

## Core Market Systems

- Virtual order book/depth by market-cap class, float value, liquidity, board state, valuation, retail emotion, and microstructure stress.
- Execution through depth with partial fills, interpolated execution prices, queue consumption, and limit-price constraints.
- Player market buys reserve cash, fill through ask depth, leave visible resting interest when unfilled, and create heat/visibility.
- Player sells consume bid depth and respect sellable T+1 inventory.
- Daily price limits use main, growth, and ST board ratios.
- Board state machine recognizes loose trading, attacking limit-up, sealed limit-up, weak seals, broken boards, panic, and limit-down.
- Ambient tape creates volume/turnover even when no explicit player or whale trade prints.
- Price engine combines residual pressure, execution shock, liquidity stress, flow memory, jitter, battle impulses, cascades, emotional breaks, and board queues.

## Actor Systems

- Retail profile reacts to day change, momentum, board state, fear, greed, panic sellers, and board faith.
- Shrimp cohorts simulate board chasers, momentum scalpers, dip buyers, panic cutters, value holders, and noise traders.
- Quants react to momentum, valuation, news, weak boards, player visibility, washouts, and multi-day market memory.
- Fundamentals produce valuation-based support/resistance and periodic EPS/growth/fair-PE digest events.
- Whales are individually simulated with cash, positions, average cost, P&L, net worth, preferences, campaigns, cooldowns, and intentions.
- Whale archetypes include pump lord, quant knife, value wall, rescue whale, bagholder whale, sector rotator, and liquidity vulture.

## Recent Market Realism Work

The latest pass added derived market memory via `src/simulation/marketMemory.ts`. Actors can now react to 1/3/5-day returns, up/down streaks, 5-day volatility, drawdowns from 10-day highs, MA5 deviation, recent limit-up/limit-down days, board breaks, and last-tick movement.

Initial daily candles were rebuilt so historical K-lines are mixed and noisy while still ending at the live previous close. This fixes artificial smooth ramps in the initial K-line view.

Whale selection was changed so each whale ranks the whole tape before acting, instead of every stock independently asking every whale in stock iteration order. This makes whale attention less predictable and makes them more responsive to overextended runners, failed boards, washouts, player visibility, and their own inventory.

Daily settlement now applies deterministic stock-specific circumstance shocks to attention, sentiment, liquidity, heat, greed, fear, panic sellers, and dip buyers. Major setup changes produce `marketCircumstance` events.

## Validation

The current validation set covers:

- deterministic RNG and initial state creation
- price-limit invariants
- T+1 inventory locking
- depth impact by market cap
- partial fills and resting orders
- whale response and accounting
- weak-board breaks
- ambient tape
- jagged intraday paths
- whale-free post-board contest
- panic cascade burstiness
- limit-up and limit-down queue behavior
- valuation pressure
- fundamental digests
- market memory derivation
- history-aware whale exits
- Red River Lithium avoiding a 20-day up-only staircase

The latest known green checks are:

```bash
npm run typecheck
npm test
```

The latest 20-day four-seed balance probe showed a more volatile market with stronger board drama and more whale interaction. Worst paths averaged around `-53%`, best paths around `+185%`, with substantially more panic, limit-up, and limit-down ticks than the earlier smoother model.

## Known Tuning Risks

- The market is intentionally spicier after the market-memory/whale rework. Repeated limit-down clusters are shorter than the first overcorrection, but still need balance attention.
- Growth names can now experience dramatic boom/bust paths; this is useful for gameplay but should be tuned against player readability.
- Bagholder whales can still lose heavily when trapped in distressed names.
- The UI is functional for inspection, but the player action surface is still less complete than the simulation core.

## Next Useful Work

- Add richer player actions: split buy, hidden sell, defend board, pull support, rumor/fear/report actions.
- Add more pre-market news templates and sector rotations.
- Improve event explanations for whale campaign phases and repeated board failures.
- Add save/load and run summary scoring.
- Continue balance probes across 20-50 seeds after each major tuning pass.
