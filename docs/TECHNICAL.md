# Ironcage — Technical Specification

The [vision](./VISION.md) says why Ironcage exists; the [product specification](./PRODUCT.md) says what it does; this specification says how it is built. The hierarchy is constitutional: a technical choice that cannot honor a product guarantee is wrong by that fact, and a product behavior that weakens a vision principle is wrong by that same fact. Within those bounds, this document is free — and expected — to make opinionated engineering choices and record why.

The test of this specification: a competent engineer should be able to read it and build the system without asking what was meant, and any two implementations that follow it should be indistinguishable where the product spec cares and free to differ where it doesn't.

This file is the map. Each part has its own document in [`docs/technical/`](./technical/) — read them in order:

0. [**Decisions**](./technical/00-decisions.md) — the decision log: every load-bearing choice, its reasoning, and what was rejected. Nothing agreed lives only in conversation.
1. [**Overview**](./technical/01-overview.md) — the whole system in one view: the stack, the runtime diagram, the two runtimes and the seam between them, and how each vision principle maps to a mechanism.
2. [**Topology**](./technical/02-topology.md) — the Workers and Durable Objects: which actors exist, what each owns, and how they communicate.
3. [**Data**](./technical/03-data.md) — Postgres as the record, Durable Object state as rebuildable projection, R2 as the artifact store; the schemas of the core domains.
4. [**Engine**](./technical/04-engine.md) — the tick, the strategy interface, the order-intent lifecycle, execution against venues, and reconciliation.
5. [**Cage**](./technical/05-cage.md) — sleeve limits and the system cage as code: evaluation, the reservation protocol, halts, and the kill switches.
6. [**AI**](./technical/06-ai.md) — the Flue agent architecture, the capability runtime, decision records, scorecards and baselines, and AI Gateway configuration.
7. [**Workbench**](./technical/07-workbench.md) — the candle store, backtests in Containers on the real engine code, and the gate pipeline as Workflows.
8. [**Money & Tax**](./technical/08-money-tax.md) — the import pipeline, deduplication, and the tax engine's event ledger.
9. [**App**](./technical/09-app.md) — the TanStack Start application, the live feed, and the API surface.
10. [**Operations**](./technical/10-operations.md) — environments, deployment, secrets, testing, and observability.

## The stack at a glance

| Layer | Choice | Where it's argued |
| --- | --- | --- |
| Language & core library | TypeScript with **Effect V4** (pinned beta) for all engine and domain code | [D1](./technical/00-decisions.md#d1) |
| Runtime platform | **Cloudflare** — Workers, Durable Objects, Workflows, Queues, Containers, R2 | [D2](./technical/00-decisions.md#d2) |
| System of record | **PlanetScale Postgres** via Hyperdrive (dual config: uncached default + cached analytics binding) | [D3](./technical/00-decisions.md#d3) |
| AI framework | **Flue** for all AI code; **AI Gateway** for all model traffic | [D10](./technical/00-decisions.md#d10), [D11](./technical/00-decisions.md#d11) |
| Durable pipelines | **Cloudflare Workflows**, Effect inside each step | [D4](./technical/00-decisions.md#d4) |
| Web application | **TanStack Start**, served from the same platform | [D18](./technical/00-decisions.md#d18) |
| Venues | **Kraken** (crypto spot) and **Alpaca** (US stocks/ETFs) — per the product spec | [PRODUCT.md](./PRODUCT.md) |

The build order across all of this is decided and planned in [ROADMAP.md](./ROADMAP.md): Money first, Tax second, the investing engine third ([D28](./technical/00-decisions.md#d28)).

Iteration-phase note: like everything in `docs/`, this specification is being actively worked. Where it is silent, the decision log is the tiebreaker; where both are silent, the question is open and worth raising, not assuming.
