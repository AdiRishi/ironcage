# Overview

The whole system in one view. This chapter names every major part once, shows how they fit, and maps each vision principle to the mechanism that enforces it. Every later chapter is a zoom into something on this page.

## The system in one diagram

```
                ┌─────────────────────── Cloudflare (operator's account) ───────────────────────┐
                │                                                                               │
   operator ────┼──▶  ironcage-app · TanStack Start observatory                                 │
                │        │ HTTPS + live WebSocket                                               │
                │        ▼                                                                      │
                │  ┌── ironcage-core · Effect V4 — the engine, no AI code runs here ─────────┐  │
                │  │                                                                         │  │
                │  │   sleeve DOs        one per sleeve: tick alarm · strategy · sleeve cage │  │
                │  │   venue-key DOs     one per API key: serialized calls · reconciliation  │  │
                │  │   system-cage DO    total exposure · drawdown kill switch               │  │
                │  │   feed DO           dashboard WebSocket fan-out                         │  │
                │  │   Workflows         gate pipeline · syncs · reports (days-long, durable)│  │
                │  │   Containers        backtests (ironcage-compute) — the real engine code │  │
                │  └───────┬──────────────────────────┬──────────────────────────────────────┘  │
                │          │ typed HTTP (binding)     │ Hyperdrive (dual config)                 │
                │          ▼                          ▼                                          │
                │  ┌── ironcage-agents · Flue ──┐   PlanetScale Postgres  ← the record           │
                │  │  every AI capability lives │   R2                    ← artifacts & exports  │
                │  │  here, and only here       │                                                │
                │  └───────┬────────────────────┘                                                │
                │          ▼                                                                     │
                │      AI Gateway ──▶ models (Anthropic, OpenAI, … — per-capability config)      │
                └──────────┬────────────────────────────────────────────────────────────────────┘
                           │ HTTPS
                           ▼
                   Kraken · Alpaca
```

Three properties of this picture are load-bearing; everything else is arrangement.

1. **The engine and the AI are different Workers.** `ironcage-core` contains the tick, the cage, execution, and every safety mechanism — and no AI code. `ironcage-agents` contains every AI capability — and no order path. (The web app and the backtest container are Workers three and four — `ironcage-app` and `ironcage-compute`, [D23](./00-decisions.md#d23).) Engine and agents meet over one service binding carrying typed HTTP ([D24](./00-decisions.md#d24)), and what crosses it is data that the engine validates before it means anything.
2. **Every single-writer is a named actor.** Race-freedom in cage checks, strict ordering of Kraken's nonce, one-at-a-time allocation of system-cage headroom — each comes from a Durable Object's guarantee that exactly one instance exists and processes messages serially. Nothing in the system relies on a lock.
3. **Postgres is the only permanent truth.** Everything else — DO state, Workflow state, platform observability — is either a rebuildable projection of it or deliberately ephemeral.

## The two runtimes and the seam

**`ironcage-core` is written in Effect V4** ([D1](./00-decisions.md#d1)): every subsystem is a service with a typed interface, wired by layers; every boundary — venue responses, config, AI outputs, order intents — is an Effect Schema; failures are typed and handled, retries are declarative. The engine's defining property is that it is *deterministic*: given the same recorded inputs, it does the same thing, which is what makes the blotter recomputable, backtests honest, and audits possible.

**`ironcage-agents` is a Flue application** ([D10](./00-decisions.md#d10)): each AI capability — the regime assessment, the event veto, categorization, report writers, research agents — is a Flue agent. Simple capabilities stay simple inside the wrapper; capabilities that grow skills, context, or tools grow in place without migration. Design-time research agents additionally get a Computer workspace ([D16](./00-decisions.md#d16)); run-time capabilities never do.

**The seam has three rules**, and they are the cage's first line:

- Agents are invoked by the engine (or by their own schedules) and **return data, never actions**. The agents Worker is bound only to a read-only API surface on core ([D24](./00-decisions.md#d24)), so no callable path exists from an agent to a venue, to Postgres's ledgers, or to another sleeve's state.
- Every payload crossing from agents to core is **re-validated with Effect Schema** on the core side before use. Flue's own schema layer is treated as wire-level; the engine's is authoritative.
- A validated run-time output then passes the **deterministic clamp**: it can only reduce what the strategy and cage would otherwise permit ([Cage](./05-cage.md)). Missing, stale, or invalid output resolves to the most restrictive default — the agent being wrong or absent can only make a sleeve more cautious.

## The rhythm of the system

Ironcage has no always-on process; it has **things that wake up** ([D6](./00-decisions.md#d6)).

- **Sleeve ticks.** Each sleeve DO arms its own alarm for its next candle boundary. On firing: fetch the closed candle (poll, [D7](./00-decisions.md#d7)) → read the latest persisted capability outputs (staleness-checked) → evaluate the strategy → clamp → cage verdict → emit an order intent or, most ticks, correctly do nothing → arm the next alarm. Idempotent on `(sleeve, candle_close_ts)`; the alarm's at-least-once guarantee makes duplicate firings harmless.
- **Capability ticks.** Agents run on their own cadences in `ironcage-agents`, persist their outputs and decision records, and are *read* by the next sleeve tick. AI is never awaited inside the order path.
- **Pipelines.** Anything spanning hours to days — a proposal moving through its gates, a tax source sync, report generation — is a Workflow: durable, per-step retried, able to sleep until the operator decides ([D4](./00-decisions.md#d4)).
- **Watchdogs.** A low-frequency cron confirms the alarms are alive; reconciliation compares our records against each venue on schedule and on reconnect, halting the sleeve on mismatch per the product spec.

## Data layering

([D9](./00-decisions.md#d9)) Three tiers, one rule each:

| Tier | Holds | Rule |
| --- | --- | --- |
| **PlanetScale Postgres** | blotter, order intents, mandates & versions, allocations, feed events, decision records, capability scorecards, Money transactions, tax events, report metadata | The record. Append-only where the domain is append-only. Money is `NUMERIC`, never floats. |
| **Durable Object SQLite** | each actor's hot state: cage counters, in-flight intents, next-alarm bookkeeping, connection state | A projection. Every byte rebuildable from Postgres; never an append log. |
| **R2** | raw venue exports, candle archives, backtest artifacts, report bodies, proposal bundles | Blobs, addressed by content or ID from Postgres rows. |

Workflows follow the **receipt discipline**: a step writes its real output to Postgres/R2 and returns only a pointer — platform workflow state is orchestration, never record.

## Observability

Two layers with different jobs ([D12](./00-decisions.md#d12)):

- **The decision layer — ours, permanent.** Every consequential AI output produces one decision record: what was asked, what data mattered, what was decided, why, when, by which model. Delivered from the agents Worker over the system's one Queue ([D25](./00-decisions.md#d25)), stored in Postgres, rendered in the Activity feed, kept forever. This is the system's log of choices made and reasons why.
- **The debugging layer — the platform's, ephemeral.** AI Gateway logs and the Agents dashboard capture the turn-by-turn internals (every prompt, tool call, token count, cost). Count-capped and truncatable by design; our decision records carry the gateway log ID so any decision links down into its raw activity while it exists.

Engine telemetry (tick timings, venue latencies, Workflow progress) uses the platform's Workers observability, with our own IDs stamped on spans so platform traces link back to our records — never the reverse dependency.

## Principles → mechanisms

The vision's principles, each with the mechanism that makes it structural rather than aspirational:

| Principle | Mechanism |
| --- | --- |
| **Fail closed** | Polling makes staleness detectable per tick; missing/invalid/stale inputs resolve to most-restrictive defaults in the clamp; a failed candle fetch stands the sleeve down; alarm handlers are idempotent so retries are safe; reconciliation mismatch freezes the sleeve. |
| **The cage is code** | Cage evaluation lives in `ironcage-core`, where no AI code runs; agent output crosses one schema-validated, reduce-only seam; the system cage is its own actor no capability can address; agents reach core only through a read-only API surface ([D24](./00-decisions.md#d24)). |
| **Capital follows evidence** | Scorecards and no-AI baselines are computed engine-side from the same simulated-fill machinery as dry run; promotions and allocations are ceremony-recorded rows in Postgres; the gate pipeline is a Workflow whose approval step is the operator's recorded event. |
| **Costs are a first-class enemy** | Every fill row carries its fees; AI spend is attributed per capability via AI Gateway; infrastructure spend is pulled from the platform's billing API; all three surface on Portfolio's cost display. |
| **Everything is auditable** | Append-only blotter and feed; decision records with reasoning; intents persisted before venue calls; Artifacts commits for every AI-proposed change; positions and equity recomputed from the record. |
| **The system is the asset** | Pinned versions upgraded deliberately; the decision log ([00-decisions](./00-decisions.md)); backtests run the real engine code ([D14](./00-decisions.md#d14)) so evidence accumulates against one implementation, not two. |

## Reading order from here

[Topology](./02-topology.md) makes the actor diagram precise — every DO class, what it owns, and every message between them. [Data](./03-data.md) turns the layering table into schemas. [Engine](./04-engine.md) and [Cage](./05-cage.md) specify the tick and the checks it passes through. [AI](./06-ai.md) specifies the agents' side of the seam. The rest zoom into their surfaces.
