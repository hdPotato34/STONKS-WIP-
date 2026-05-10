# STONKS-WIP Roadmap

## Current Read

The core simulation is playable and substantially more reactive after the market-memory and whale rework. The next layer should make player tools catch up to the simulation depth while continuing balance probes across many seeds.

The latest balance probe shows:

- daily K-lines now vary instead of producing smooth up-only staircases
- multi-day memory makes whales, quants, shrimp cohorts, and fundamentals react to streaks, drawdowns, failed boards, and repeated locks
- distressed and growth names can now produce dramatic board clusters, including repeated limit-downs
- whale P&L is visible and meaningfully differentiated by actor
- the market is more challenging, but balance now needs tuning around how often disaster chains appear

## Next Objective

Objective: Player Tools And Balance Control.

Goal: make a 10-30 day no-player or light-player run produce a believable mix of themes:

- a few weak stocks can keep falling
- some healthy/cheap names can recover
- some speculative names can attack or seal boards
- panic/limit-down clusters should be visible without becoming the only story in every seed
- whale P&L should help explain who is trapped, who is harvesting, and who has dry powder
- player actions should be strong enough to interact with whales without becoming guaranteed price buttons

## Immediate Work

1. Add player execution actions.
   - Split buy.
   - Hidden sell.
   - Defend board.
   - Pull support.

2. Add influence tools.
   - Push rumor.
   - Spread fear.
   - Commission report.
   - Add delayed clarification/backfire risk.

3. Improve explainability.
   - Track whale campaign phase in trace/event output.
   - Add event text for multi-day exhaustion, stop-loss cascades, and rescue absorption.
   - Surface recent market-memory signals in CLI/UI stock detail.

4. Continue balance probes.
   - Watch growth-stock repeated lock-down counts.
   - Watch no-player upside-board frequency.
   - Watch whale P&L so opposition can be dangerous without simply donating money.
   - Watch whether large-cap overrun supply caps smooth long rallies.

5. Expand sparse news/templates after the player tools are testable.

## Deferred

- Save/load.
- Full news template expansion.
- Visual assets.
- Final 30-day scoring screen.

The CLI and React UI both work as inspection surfaces, but the CLI remains the fastest tuning harness.
