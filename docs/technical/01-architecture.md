# Architecture

Ironcage runs as four Cloudflare Workers around one Postgres database. There is no always-on process anywhere: the system is a set of named actors that wake on schedules, durable pipelines that sleep between steps, and a web app that watches. This chapter places every component and names every connection. It stops at the boundaries: what crosses them is specified in [Contracts](./04-contracts.md), and what each component does inside is its own chapter.

## What this chapter guarantees

- A reader can place every component: which Worker it lives in, what state it holds, and what wakes it.
- Every connection between components is listed here, with its reason. A connection not listed does not exist.
- For any piece of shared state, a reader can name the single writer that owns it.
- Every vision principle maps to a named mechanism, in this chapter or in a chapter this one points to.

## The system in one picture

```
            ┌─────────────────────────── Cloudflare (personal account) ───────────────────────────┐
            │                                                                                     │
 operator ──┼─▶ ironcage-app        TanStack Start observatory, behind Cloudflare Access          │
            │        │ AppApi (typed HTTP) + feed WebSocket       │ conversations only            │
            │        ▼                                            ▼                               │
            │   ironcage-core ──── service binding (dispatch) ─▶ ironcage-agents                  │
            │     the engine (Effect V4) — no AI code runs here    every AI capability (Flue)     │
            │     ├─ sleeve actors      one per sleeve: tick, cage, strategy state                │
            │     ├─ venue actors       one per API key: serialized private venue calls           │
            │     ├─ system-cage actor  exposure reservations, mode enforcement, outbox drain     │
            │     ├─ feed actor         dashboard WebSocket fan-out                               │
            │     ├─ Workflows          gate pipeline, tax syncs, reports                         │
            │     └─ queue consumer  ◀─── decision-records queue ─── (agents)                     │
            │        │ Hyperdrive ×2                                  │ AI Gateway → models       │
            │        ▼                                                                            │
            │   PlanetScale Postgres        R2 (blobs, exports, proposal-bundle quarantine)       │
            │                                                                                     │
            │   ironcage-compute        backtest and document-extraction containers                │
            └───────────┬─────────────────────────────────────────────────────────────────────────┘
                        │ HTTPS
                        ▼
                Kraken · Alpaca
```

Three properties of this picture carry everything else.

**The engine and the AI are different Workers.** `ironcage-core` contains the tick, the cage, order execution, and every safety mechanism. It contains no AI code. `ironcage-agents` contains every AI capability and has no path to an order. What crosses between them is data, and the engine validates it before it means anything. The full seam is specified in [Contracts](./04-contracts.md) and [AI](./07-ai.md).

**Every single-writer is a named actor with an explicit critical section.** Cage checks must not race, Kraken's nonce must strictly increase, and exposure headroom must be granted one request at a time. Each gets one Durable Object identity. Durable Object handlers may interleave across `await`, so the venue actor uses a durable FIFO plus one in-flight drainer, and cage read/check/write sections execute in one storage or Postgres transaction with no external await. The object identity supplies ownership; the protocol supplies serialization.

**Postgres is the only permanent financial truth.** Every Ironcage trading actor's local state is either an in-flight marker or a projection that can be rebuilt from Postgres. R2 holds immutable bytes named by Postgres rows. Flue separately persists sensitive conversation and execution state in Durable Object SQLite; it is neither rebuildable from Postgres nor allowed to carry financial authority. Gateway and Workflow retention also follow their platform contracts. The inventory and commit-point rules are specified in [Data](./03-data.md) and [AI](./07-ai.md).

## Principles to mechanisms

The vision states principles. A principle that lives only in prose decays, so each one is enforced by a mechanism a reader can point to. This table is the index; each mechanism's chapter has the full definition.

| Principle                         | Mechanism                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fail closed**                   | Entry checks reject on any unknown input, without exception. Monitors degrade in stages: retry, then stand down for the tick, then halt only on a computed breach or sustained blindness ([The tick](./05-the-tick.md)). Missing, stale, or invalid AI output resolves to its safe default in the clamp. An unreadable kill switch reads as kill.  |
| **The cage is code**              | Cage evaluation lives in core, where no AI code runs. Agents reach core only through a read-only API and one queue, every payload is re-validated on the core side, and a validated output can only reduce what the strategy and cage would otherwise permit. The system cage is its own actor that no capability can address.                     |
| **Capital follows evidence**      | Scorecards compare each capability against its no-AI identity, computed engine-side under one fill model ([AI](./07-ai.md)). Promotions and allocations are ceremony-recorded rows in Postgres. The gate pipeline is a Workflow whose approval step is the operator's recorded decision ([Workbench](./10-workbench.md)).                          |
| **Costs are a first-class enemy** | Every fill row carries authoritative venue fees. AI Gateway supplies estimated per-capability cost; provider bills remain exact authority. Infrastructure cost is entered from Cloudflare billing until a populated supported API exists. The Portfolio labels each source accordingly ([Operations](./12-operations.md)).                         |
| **Everything is auditable**       | The blotter and the feed record are append-only Postgres tables. Intents are persisted before any venue call. Every AI decision leaves a permanent decision record. Proposal bundles are content-addressed objects in a dedicated R2 quarantine bucket. Positions and equity are recomputable from the record, and reconciliation recomputes them. |
| **The system is the asset**       | Versions are pinned and upgraded deliberately. Backtests run the real engine code in a container, so evidence accumulates against one implementation, not two. The decision archive keeps settled questions settled.                                                                                                                               |

## The four Workers

The split is forced by the platform before it is chosen by us: TanStack Start and Flue each own their Worker's build entry, a Durable Object class lives in exactly one Worker, and a container image build couples to its Worker's deploy. Operationally they are still one product: every push to `main` builds, migrates, and deploys all four in one fixed-order release, then verifies the whole system. There are no independent product rollouts or percentage promotions.

| Worker             | Contains                                                                                                                                                                                                                  | May be broken without risk to money?                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `ironcage-app`     | The observatory: SSR, assets, server functions, the feed WebSocket route. Two bindings: core's operator API and the agents Worker's conversation surface. No database, no secrets beyond its session, no Durable Objects. | Yes. It can only call what core's API offers, and the conversation surface carries no mutation.                                   |
| `ironcage-core`    | The engine: all trading Durable Object classes, Workflows, the cron watchdog, both Hyperdrive bindings, the queue consumer, venue credentials.                                                                            | No. A failed whole-system release remains entry-blocked and is fixed forward or replaced by the previous compatible whole commit. |
| `ironcage-agents`  | The Flue application: every AI capability, AI Gateway provider configuration, the queue producer, the conversation surface.                                                                                               | Yes. If it breaks, capability outputs go stale and every consumer degrades to its safe default.                                   |
| `ironcage-compute` | The trusted Worker wrapper, narrow run-scoped R2 bindings, and untrusted backtest/import container with no database secret or general egress. A separate trusted backup-container profile owns `pg_dump`.                 | Yes. Backtests/imports fail visibly; nothing live depends on them.                                                                |

## Who may call whom

Every arrow is a wrangler binding. Cross-Worker calls are typed HTTP over service bindings; the caller uses a generated client from `packages/contracts`, and the callee re-validates every payload regardless of caller.

| Caller → Callee       | Surface                          | Why it exists                                                                                                                                                                        |
| --------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| app → core            | `AppApi` (full operator surface) | Everything the observatory renders and every ceremony it performs                                                                                                                    |
| app → agents          | Conversation surface only        | AI conversations render in the app without transiting the money-path Worker. No mutating operation exists on this surface, and conversation model spend is capped at the AI Gateway. |
| agents → core         | `AgentReadApi` (read-only)       | Context for AI work: candles, positions, mandates, scorecards. No mutating operation exists on this surface.                                                                         |
| agents → queue → core | `decision-records` queue         | The only write path out of the AI: outputs and decision records, consumed and validated by core                                                                                      |
| core → agents         | Flue dispatch                    | Core or schedules invoke agents; agents never invoke themselves into core                                                                                                            |
| core → compute        | Durable Object binding           | Workflows start backtest runs; Money requests isolated statement extraction                                                                                                          |
| core → Postgres       | Hyperdrive ×2                    | Uncached binding is the default; cached binding is opt-in for analytics reads ([Data](./03-data.md))                                                                                 |
| core → R2             | bucket bindings                  | Blobs, exports, and the proposal-bundle quarantine bucket                                                                                                                            |
| compute wrapper → R2  | narrow bucket bindings           | Run-scoped content-addressed inputs/outputs only; the container reaches them through outbound handlers and never receives a database credential                                      |
| agents → AI Gateway   | provider config                  | Every model call, no exceptions ([AI](./07-ai.md))                                                                                                                                   |

The engine–AI seam follows three rules, and they are the cage's first line. First, agents are invoked by core or by their own schedules, and they return data, never actions; their only paths into core are the read-only API and the queue. Second, every payload crossing into core is re-validated with the engine's own schemas before it is used, no matter what validation the sender already ran. Third, a validated run-time output then passes the deterministic clamp: it can only reduce what the strategy and cage would otherwise permit, and a missing, stale, or invalid output resolves to the capability's safe default. The clamp's exact semantics live in [The tick](./05-the-tick.md); the distinction between a safe default and a no-AI identity lives in [AI](./07-ai.md).

Deliberately absent, and load-bearing by their absence:

- The app Worker has exactly two bindings. Its core binding exposes the deliberate operator surface, including ceremony-protected financial mutations; it has no venue/database credential and can do nothing the typed core API does not offer. The conversation binding cannot mutate anything.
- The agents Worker cannot reach Postgres, R2, the venues, or any core Durable Object. "Agents return data, never actions" is wiring, not policy.
- Venue credentials exist only in core, as Worker secrets, readable only by the venue actors.
- Nothing calls the app Worker except the operator's browser, and Cloudflare Access sits in front of that ([App](./11-app.md)).

## The actors

All engine actors live in core, use SQLite-backed storage, and are addressed by stable names. Each implements `rebuild()`: drop local state, reconstruct from Postgres. Rebuild is a routine operation, run on first start or on demand.

**Sleeve actor** — one per sleeve, named by sleeve ID. Owns the sleeve's tick, cage counters, strategy-state cache, and in-flight markers. Every durable fact it produces is a Postgres row; its local storage holds only markers and rebuildable projections. Its entire behavior is [The tick](./05-the-tick.md).

**Venue actor** — one per API key: `kraken-primary`, `alpaca-primary`. Owns the credential, the nonce, the rate budget, order execution, and reconciliation. Specified in [Venues](./06-venues.md).

**System-cage actor** — singleton. It grants exposure headroom one request at a time and serializes the reservation ledger; the reservation protocol is in [The tick](./05-the-tick.md). It enforces the system mode, whose authoritative copy is a Postgres row changed only by ceremony or by an automatic halt. Its alarm also drains the Postgres outbox of delivery obligations, which at v1 means the halt email; the outbox's contents and guarantees are in [Data](./03-data.md). Its rules are configuration changed only by ceremony, and no AI capability may address it or propose a change to it.

**Feed actor** — singleton, and deliberately the least critical component in the system. It holds the dashboard's WebSocket connections and nothing else. The feed's record is in Postgres, written by each event's originating actor in the same transaction as the fact itself; a lost feed actor loses zero information, because the client re-reads from the record on reconnect ([App](./11-app.md)).

**Flue conversation actors** — generated by Flue inside the agents Worker, one instance per conversation. They durably hold canonical transcript/submission state under the access and retention policy in [AI](./07-ai.md), never engine state.

**Backtest container** — a container-backed Durable Object class in compute. It runs `packages/engine`, the same code core runs, against pinned inputs. It emits content-addressed R2 artifacts only; trusted core verifies and commits their summary. Specified in [Workbench](./10-workbench.md).

**Statement-extraction container** — a separate container profile in compute. It runs the pinned AnyDoc image against PDF bytes supplied by core and returns derived Markdown plus its image digest. It has no database credential, no general egress, and no authority to interpret financial rows. Core performs that validation under [Money](./08-money.md).

## The mode and the brakes

Trading permission must survive vendor outages and never be granted by anything eventually consistent. The system mode and every sleeve's lifecycle state therefore live in Postgres and change only through the ceremony, or through an automatic halt that any safety mechanism may write. Flagship holds only kill switches, and a kill switch is a brake: the flags are checked in series before risk-increasing work, the effective answer is the more restrictive of the Postgres mode and the flags, and a flag that cannot be read is treated as kill. No flag can start, resume, or loosen anything.

## The one cost of the actor model

A Durable Object processes messages one at a time, but that protection does not hold across an `await` of external I/O. While a venue HTTP call is in flight, other messages can interleave. Every actor that performs external I/O therefore follows one discipline: record what is about to happen durably, then call out, then settle. A message arriving mid-flight sees honest state and reacts to it. A duplicate tick no-ops; a halt defers winddown until the in-flight call resolves. [The tick](./05-the-tick.md) applies this discipline to the decision transaction, and [Venues](./06-venues.md) applies it to every venue call.

## How the system runs with nothing always-on

- **Sleeves tick** on their own alarms at candle boundaries. The alarm is the only scheduling primitive on the platform with a documented at-least-once guarantee, so it is the authority. A cron watchdog runs every 5 minutes, re-arms dead alarms off the Postgres `next_due_at` schedule row, and reports having done so.
- **Capabilities run** on their own schedules in the agents Worker and persist outputs. The engine reads the latest output; it never waits for AI.
- **Pipelines** are Workflows: proposals moving through gates, tax syncs, report generation. Each is durable, retried per step, and able to sleep until the operator decides.
- **Reconciliation** runs per venue on schedule, on startup, and after connectivity loss.
- **The operator's browser** connects when the operator cares. Nothing depends on it being open.

## Observability in brief

The records have different jobs, specified fully in [AI](./07-ai.md) and [Operations](./12-operations.md). The decision layer is ours and permanent: every consequential AI output produces one Postgres decision record with returned Gateway Log IDs when captured and application-owned OpenTelemetry IDs. Gateway logs follow count/storage deletion policy, not a day promise; Flue conversation/execution state is durable DO state rather than ephemeral observability. Neither platform record replaces the decision record.

Vitals are computed from Postgres rows, so a dead engine shows dead rather than showing its last healthy screenshot. Because the vitals, the feed, and the halt-email outbox all live inside core, an external dead-man monitor watches a signed health route to cover the one failure they cannot report: core itself being down. The monitor and the vitals table are specified in [Operations](./12-operations.md).

## Values set in this chapter

| Value                              | Default   | Owner         | Status   |
| ---------------------------------- | --------- | ------------- | -------- |
| Watchdog cron cadence              | 5 minutes | engine config | proposed |
| Smart Placement on `ironcage-core` | disabled  | engine config | proposed |
| Unreadable kill-switch reading     | kill      | engine config | decided  |

## Alternatives considered

- **One Worker for everything.** Impossible twice over: TanStack Start and Flue each demand ownership of a Worker's entry point, and mixing them has no supported configuration.
- **One engine Durable Object running all sleeves.** Rejected: one slow venue call would stall every sleeve behind it, and one defect would wedge the object that runs everything. Sleeves are isolated tenants in the product; the actor split makes them isolated tenants in the runtime.
- **Database-centric correctness (stateless Workers plus row locks).** Rejected: a cage check and its venue call would have to either hold a Postgres lock across an ocean-crossing HTTP request or split the transaction and re-check racily.
- **Native Workers RPC between Workers.** Rejected: RPC calls ignore Smart Placement, and core's latency is dominated by its distance to Postgres. Typed HTTP over the same service bindings keeps the developer experience and the placement options.
- **Routing AI conversations through core.** Rejected: it would put conversational traffic on the money-path Worker for no safety gain, since the conversation surface holds no mutation path and its model spend is bounded first by the application and backed by Gateway rules. A direct app-to-agents binding keeps core's surface small.
- **Cloudflare Artifacts for proposal bundles.** Rejected: it added a platform dependency for what is content-addressed blob storage. A dedicated R2 quarantine bucket with bucket locks does the same job on infrastructure the system already runs; the bundle lifecycle is in [Workbench](./10-workbench.md) and [AI](./07-ai.md).

## Open questions

1. **Smart Placement on core.** Safe fallback while open: leave it disabled, which is the platform default. Must close before: the first live-mode deploy of the engine. Evidence that closes it: measured tick and venue-call latencies from core to Postgres with placement on and off, under the real region assignment.

## Build checklist

- [ ] Four wrangler configs with exactly the bindings in the table above, deployed by one root release command from `main`
- [ ] `packages/contracts` exporting `AppApi`, `AgentReadApi`, the conversation-surface types, and the queue message schema
- [ ] Actor skeletons with `rebuild()` implemented and tested against a seeded Postgres
- [ ] The watchdog cron keyed on the Postgres `next_due_at` row, with its re-arm feed event
- [ ] A test that asserts the agents Worker's environment contains no Postgres, R2, or Durable Object bindings
- [ ] A test that asserts the app Worker's environment contains exactly the core and agents bindings
- [ ] A test that the untrusted compute container has no database secret or general egress, can access only run-scoped R2 handlers, and that core rejects a forged digest/receipt
