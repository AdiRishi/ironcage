# Ironcage — Technical Specification

The [vision](./VISION.md) says why; the [product specification](./PRODUCT.md) says what. This is how: the system that delivers those surfaces. Where this conflicts with either, they win and this document is wrong. Terms are defined in [`CONTEXT.md`](../CONTEXT.md); hard-to-reverse decisions get ADRs in [`docs/adr/`](./adr/AGENTS.md).

This file is the map. Each area has its own document in [`docs/technical/`](./technical/) — read them in order:

1. [**Architecture**](./technical/01-architecture.md) — the Cloudflare topology, the gateway, and the monorepo.
2. [**Domain model & persistence**](./technical/02-domain-model.md) — schemas, tables, and where every kind of data lives.
3. [**The engine**](./technical/03-engine.md) — sleeve execution: ticks, the cage, the trade pipeline, simulated fills, reconciliation.
4. [**Grants & the gate pipeline**](./technical/04-grants.md) — how AI runs: attenuators, control ledgers, proposals, gates.
5. [**Integrations**](./technical/05-integrations.md) — Kraken, Alpaca, the gateway service, CommBank import, AI providers.
6. [**The frontend**](./technical/06-frontend.md) — the observatory's data flow: server functions, liveness, auth.
7. [**Operations**](./technical/07-operations.md) — environments, secrets, deploys, observability, backups, runbooks.

## Commitments that bind every document

- **Cloudflare-first.** Workers, Durable Objects, Workflows, D1, R2, Queues, Cron Triggers, and AI Gateway are the platform. The single exception is the **gateway**: a small static-IP VPS (reached only via Cloudflare Tunnel) for exchange-facing calls, forced by exchange IP-allowlisting and Workers' unpublished egress (ADR-0002).
- **Effect TS end to end.** Services, errors, retries, schedules, and schemas are Effect-native. Contracts are `effect/Schema`; all money and quantity math is `effect` `BigDecimal` — never IEEE floats. `.repos/effect` (once vendored) is the reference for idiomatic usage.
- **AI communicates through the database, never the execution path** (ADR-0001). Grant runners write schema-validated rows; the engine reads them on its own schedule. No AI-influenced code has a network path to the gateway. The four valve classes are closed (ADR-0003).
- **One writer per decision domain.** Each sleeve is one Durable Object; the capital ledger and system cage are one Durable Object. Serialized execution makes double-ordering and double-allocation structurally impossible.
- **Same code path everywhere.** `@app/core` is pure and I/O-free; identical strategy/cage/blotter code runs in backtests, dry run, and live. Mode changes swap the execution edge, never the logic.
- **Blotter-derived state.** Positions, average entries, realized P&L, and equity are recomputed from the immutable order history — never mutated incrementally. Reconciliation against venues runs on schedule; discrepancy halts.
- **Fail closed, everywhere, mechanically.** Stale grant output → most restrictive default. Uncomputable cage inputs → rejection. Gateway unreachable → no trading. These are code paths, not policies.

## Standing decisions (defaults; veto in review)

- **Reporting currency: AUD.** Each sleeve accounts in its native trading currency (Kraken AUD or USD pairs; Alpaca USD); whole-of-wealth views convert at a marked FX rate with its timestamp shown.
- **Auth: Cloudflare Access** in front of the web app — one operator, SSO via email OTP or passkey, zero password infrastructure of our own.
- **Gateway host:** one ~US$5/month static-IP VPS (Hetzner or equivalent), no inbound ports, Cloudflare Tunnel only.
- **Environments:** production plus local dev (`wrangler dev`/Miniflare). No staging — dry-run mode *is* the rehearsal space, and it runs in production infrastructure on purpose.
- **Backups:** D1 Time Travel (built-in, 30 days) plus a scheduled export of the blotter and event log to R2; R2 object versioning on.
- **Timezone:** all storage and scheduling in UTC, candle-aligned; the frontend renders Australia/Sydney.

## Known build-time risks

Named so they're spiked early, not discovered late: **Workers CPU limits vs. backtests** (walk-forward over years of 4h candles should fit the paid plan's 30s–5min CPU; if a heavy sweep ever doesn't, it moves to a Container without changing `@app/core`); **Alpaca AU onboarding mechanics** (funding rails; crypto availability — verify at account opening, nothing depends on it); **AUD-pair liquidity on Kraken** beyond BTC/ETH (mandates declare pairs explicitly, so this constrains mandates, not architecture); **Effect v4 beta churn** (pinned via pnpm catalog; upgrades are deliberate commits with the vendored repo re-synced).
