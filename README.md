# Ironcage

A personal automated trading system: **AI brain, iron cage**. An LLM synthesizes market regime judgments on a slow cadence; deterministic Effect TS code — which the LLM can never override — owns strategy, risk, and execution. Runs on Cloudflare (Workers, Durable Objects, D1, R2), with a TanStack Start dashboard.

**Start with the docs — this repo is documentation-first:** [`docs/VISION.md`](./docs/VISION.md) → [`docs/PRODUCT.md`](./docs/PRODUCT.md) → [`docs/TECHNICAL.md`](./docs/TECHNICAL.md), glossary in [`CONTEXT.md`](./CONTEXT.md), decisions in [`docs/adr/`](./docs/adr/AGENTS.md).

## Quick start

```bash
pnpm install
pnpm sync:repos       # vendor reference repos into .repos/ (effect, freqtrade, condor)
pnpm dev:web          # dashboard on :8080
pnpm dev:engine       # engine worker (wrangler dev)
pnpm dev:regime       # regime worker (wrangler dev)
```

Checks: `pnpm check` (typecheck + lint + format) and `pnpm test`.

## Layout

```
apps/
  web/        TanStack Start dashboard (React 19, Tailwind v4, shadcn/ui)
  engine/     Cloudflare Worker + Engine Durable Object — the trading loop
  regime/     Cloudflare Worker (cron) — LLM regime ticks via AI Gateway
packages/
  contracts/  effect/Schema contracts (@app/contracts)
  core/       pure domain logic: risk cage, sizing, blotter (@app/core)
scripts/      repo tooling (reference-repo sync)
docs/         vision, product, technical, ADRs
.repos/       vendored read-only reference repos (pnpm sync:repos)
```

## Status

Milestone **M0 — Foundations** (see the milestone ladder in [`docs/PRODUCT.md`](./docs/PRODUCT.md)). The workers are scaffolds with the seams in place; no trading logic is live. Nothing here is financial advice; this system is personal, experimental, and sized so total loss is affordable.
