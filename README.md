# STONKS-WIP

A deterministic stock-market tactics prototype about limit-up boards, retail emotion, rival whales, liquidity, and timing.

The project is a fictional A-share-inspired market simulation. It is not trying to be a statistically exact finance model; the goal is a readable market game where pressure, fear, greed, whale campaigns, and player orders create tense and learnable situations.

## Current State

- TypeScript + Vite + React app shell.
- Headless deterministic market kernel with seeded runs.
- Fictional stock, sector, whale, news, retail, shrimp cohort, quant, and institution actors.
- Virtual depth and execution layer with partial fills, resting visible buy interest, queues, and T+1 inventory locking.
- Limit-up and limit-down board mechanics with sealed boards, weak seals, broken boards, panic states, and lock-down queues.
- Whale accounting with cash, positions, average cost, realized P&L, unrealized P&L, and net worth.
- Multi-day market memory used by whales, quants, retail cohorts, fundamentals, and daily setup.
- CLI and balance-probe harnesses for testing market behavior across seeds.
- React UI for inspecting the market, selected stock details, intraday tape, K-line candles, whale prints, and player state.

## Quick Start

```bash
npm install
npm run dev
```

Useful simulation commands:

```bash
npm test
npm run typecheck
npm run build
npm run play
npm run balance -- balance-1,balance-2,balance-3,balance-4 20
```

## Project Layout

- `src/game`: core types, config, RNG, initial game creation, charting, fundamentals.
- `src/content`: fictional sectors, stocks, whales, and shrimp cohort setup.
- `src/simulation`: market engines for depth, price, boards, retail, shrimp cohorts, whales, quants, fundamentals, settlement, and ticks.
- `src/player`: player order handling and portfolio accounting.
- `src/sim`: CLI, headless runner, formatting helpers, and balance probe.
- `src/ui`: React interface.
- `docs`: roadmap and implementation progress notes.

## Design Pillars

- Boards are the drama: limit-up seals, weak boards, broken boards, panic cascades, and limit-down locks should be legible.
- T+1 matters: entries commit the player and make exits a separate strategic problem.
- The market should remember: multi-day runs, drawdowns, failed boards, and prior locks should affect today.
- Whales should feel like actors: they can campaign, attack, defend, distribute, get trapped, and return.
- Fictional only: fictional companies, sectors, news, institutions, and market actors.
