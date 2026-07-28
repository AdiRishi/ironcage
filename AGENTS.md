# AGENTS.md

## Task Completion Requirements

- `pnpm check` and `pnpm test` must pass before considering tasks completed.

## Project Snapshot

Ironcage is a personal automated trading system with an "AI brain, iron cage" architecture: an LLM synthesizes market regime judgments on a slow cadence, while deterministic TypeScript code — which the LLM can never override — owns strategy signals, risk limits, and order execution. The brain runs on Cloudflare (Workers, Durable Objects, Workflows, D1, R2); exchange-facing calls go through a thin static-IP gateway. Built with Effect TS end to end.

## Documentation — read before designing or building anything

This project is documentation-first; the docs are authoritative over any assumption. In reading (and precedence) order:

1. [`docs/VISION.md`](./docs/VISION.md) — why Ironcage exists, the evidence it is built on, and the principles that bind it. Where documents conflict, the vision wins.
2. [`docs/PRODUCT.md`](./docs/PRODUCT.md) — what the system does: surfaces, modes, and the milestone ladder.
3. [`docs/TECHNICAL.md`](./docs/TECHNICAL.md) — how it's built: architecture, domain model, and the Cloudflare platform mapping.
4. [`CONTEXT.md`](./CONTEXT.md) — the domain glossary (regime signal, order intent, risk cage, blotter, pair lock…). Use these terms exactly, including their listed _avoid_ words.
5. [`docs/adr/`](./docs/adr/AGENTS.md) — why the hard-to-reverse decisions were made.

Any change that contradicts these documents is wrong until the documents are changed first.

## Core Priorities

1. **Fail closed.** Missing data, stale signals, or uncomputable risk state must always resolve to "don't trade". Never invert this.
2. **The cage is deterministic.** Nothing on any LLM-influenced code path may place, enlarge, or extend a position. The LLM's output can only reduce what the strategy would otherwise do.
3. **Auditability.** Every decision — strategy signal, regime input, risk verdict, order event — must be reconstructable from persisted state.
4. Correctness and robustness over short-term convenience, always. This system will eventually touch real money.

## Money Math

All monetary and quantity arithmetic uses `BigDecimal` from `effect` — never IEEE floats. Derived state (average entry, realized PnL, equity) is always **recomputed from the immutable order history**, never mutated incrementally. See `packages/core/src/blotter/`.

## Tests

Unit tests live in each package's `tests/` directory, mirroring the source tree: the test for `src/risk/cage.ts` is `tests/risk/cage.test.ts`. Never colocate `.test.ts` files under `src/`. Use `@effect/vitest` for Effect-aware tests. When adding a package, include `tests/**` in its `tsconfig.json` or the tests silently stop typechecking.

## Package Roles

- `apps/web`: TanStack Start dashboard (React 19 + Vite). Equity curve, positions, trade log, regime state. Based on the tanstack-start-starter; see its own `AGENTS.md` for frontend conventions.
- `apps/engine`: Cloudflare Worker hosting the Engine Durable Object — the single-writer trading loop. Owns candle-aligned alarms, strategy evaluation, the risk cage, and order intents. The only component allowed to decide to trade.
- `apps/regime`: Cloudflare Worker on a cron trigger. Assembles market context, calls the LLM through AI Gateway, and writes a schema-validated regime signal to the database. Has **no** path to execution — it communicates through data only (ADR-0001).
- `packages/contracts`: `effect/Schema` contracts shared by everything — regime signals, order intents, trades/orders, risk config. Schema-only; no runtime logic.
- `packages/core`: Pure domain logic — risk cage, position sizing, blotter recomputation. No I/O, no platform APIs; this package must run identically in the backtester, in dry-run, and live.
- `scripts`: Repo tooling — reference-repo sync.

## Workspace Conventions

- Workspace packages ship raw TypeScript source — `exports` maps point at `./src/*.ts`, no build step (ADR-0003).
- `@app/core` is subpath-only (`@app/core/risk/cage`) — no barrel index. `@app/contracts` keeps a root barrel because it is schema-only and consumed wholesale by design.
- Task orchestration is Turborepo (`pnpm dev`, `pnpm build`, `pnpm typecheck`, `pnpm test` fan out via `turbo`); linting and formatting run once at the root (oxlint / oxfmt).

## Vendored Repositories

`.repos/` holds read-only vendored reference repos, managed by `pnpm sync:repos`. See `.repos/AGENTS.md`.

- When writing Effect code, read `.repos/effect/LLMS.md` first and inspect `.repos/effect/` for examples of idiomatic usage, tests, module structure, and API design.
- `.repos/freqtrade` and `.repos/condor` are prior art for trading mechanics (order lifecycle, dry-run fill simulation, protections) and LLM-harness design respectively. Prefer their battle-tested patterns over invented ones — but reimplement, never import.
