# Topology

The [overview](./01-overview.md) drew the system; this chapter makes it precise: the four Workers, every Durable Object class, who may call whom, and which invariant each single-writer owns. The rule this chapter enforces throughout is **least connection**: every binding that exists is listed here with its reason, and a binding not listed here does not exist.

## The four Workers

([D23](./00-decisions.md#d23)) Boundaries are mostly forced — TanStack Start and Flue each own their Worker's build entry, Durable Object classes live in exactly one Worker, and a Container image build couples to its Worker's deploy.

| Worker                 | Owns                                                                                                                                         | Build                                                                                                 | Deploys                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **`ironcage-app`**     | TanStack Start: SSR, static assets, session auth, server functions, the WebSocket ticket route                                               | Vite (`tanstackStart` + `cloudflare` plugins)                                                         | Freely — it holds no state and can never touch money                                   |
| **`ironcage-core`**    | The engine: every Durable Object class below, Workflows, the cron watchdog, both Hyperdrive bindings, the Queue consumer, venue HTTP clients | Plain Worker build (`wrangler`)                                                                       | Fast and rolls back instantly; never waits on anything                                 |
| **`ironcage-agents`**  | The Flue application: every AI capability, AI Gateway provider configuration, the Queue producer                                             | Vite (`flue` + `cloudflare` plugins; Flue generates one DO class per agent for its own conversations) | On its own cadence; a broken agents deploy degrades AI to safe defaults, never trading |
| **`ironcage-compute`** | The backtest Container class (a Durable Object fronting the container) and its Dockerfile                                                    | `wrangler` + Docker image                                                                             | Rarely; kept off core's deploy path so an image build never delays or blocks core      |

## The binding graph

Every arrow is a wrangler binding; the direction is who may initiate. Cross-Worker calls are typed HTTP over service bindings ([D24](./00-decisions.md#d24)) — the caller uses a generated client from `packages/contracts`, the callee validates with Effect Schema regardless of who is calling.

```
  ironcage-app ──── service binding ───▶ ironcage-core      (full operator API)
  ironcage-agents ─ service binding ───▶ ironcage-core      (READ-ONLY surface)
  ironcage-agents ─ queue producer ────▶ decision-records ─▶ consumed by ironcage-core
  ironcage-core ─── service binding ───▶ ironcage-agents    (invoke/dispatch agents)
  ironcage-core ─── DO binding (script_name) ─▶ ironcage-compute  (run backtests)
  ironcage-core ─── Hyperdrive ×2 ─────▶ PlanetScale        (uncached default + cached)
  ironcage-core ─── R2 ────────────────▶ artifacts bucket
  ironcage-agents ─ AI Gateway ────────▶ models
```

What is deliberately absent:

- **The app Worker has exactly one binding** — core. No Hyperdrive, no R2, no DO namespaces, no venue credentials. A compromised or buggy app deploy can do nothing the core API doesn't explicitly offer.
- **The agents Worker cannot reach Postgres, R2, the venues, or any core DO.** Its two paths are the read-only API surface (context for its work) and the decision-records queue (delivering its outputs). "Agents return data, never actions" is wiring, not policy.
- **Nothing calls the app Worker** except the operator's browser.
- **Venue credentials exist only in core**, as Worker secrets, readable by the venue-key DOs alone.

Core exposes two named API surfaces, both defined as Effect `HttpApi` in `packages/contracts`: **`AppApi`** (the full operator surface: everything the observatory renders and every ceremony it performs) and **`AgentReadApi`** (the strict subset agents may see: candles, positions, mandate text, scorecards, recorded events — nothing that mutates). Two surfaces, one Worker, no ambiguity about which caller gets which.

## The Durable Objects

All engine DO classes live in `ironcage-core` and use SQLite-backed storage. Identity is by name (`idFromName`), so every actor's address is a stable, human-readable string. Per [D9](./00-decisions.md#d9), every byte of DO state is a rebuildable projection of Postgres — rebuild is a normal operation, not a recovery heroic.

### Sleeve actor — one per sleeve, named by sleeve ID

The single-writer for everything one sleeve decides ([D5](./00-decisions.md#d5)).

- **Owns**: the tick alarm (self-rescheduling, [D6](./00-decisions.md#d6)); the active mandate version's parameters and limits (cached from Postgres); strategy working state; cage counters (positions open, daily loss, trade frequency); in-flight intent markers; the outbox ([D25](./00-decisions.md#d25)) of feed events and other must-deliver effects awaiting flush.
- **On its alarm**: runs the tick — fetch closed candle → read persisted capability outputs (staleness-checked) → evaluate strategy → clamp → sleeve-cage verdict → system-cage reservation → hand the intent to the venue actor → record everything, arm the next alarm. Idempotent on `(sleeve, candle_close_ts)`; the full sequence is [Engine](./04-engine.md).
- **Calls**: the system cage (reserve/commit/release), its venue actor (execute intent), the feed actor (best-effort push), Postgres (record + outbox flush).
- **One alarm serves two schedules**: the next tick and the outbox retry — the DO arms `min(nextTick, nextRetry)` and dispatches on wake, since a Durable Object has exactly one alarm.

### Venue actor — one per venue API key

The single-writer for one venue relationship. Two instances at launch: `kraken-primary`, `alpaca-primary`.

- **Owns**: the API credential (read from Worker secrets); the strictly-increasing nonce (Kraken); the request rate budget; order execution with the query-then-post discipline ([D8](./00-decisions.md#d8)); the reconciliation alarm (on schedule, on startup, and after connectivity loss, per [Operations](../product/07-operations.md)); burst-polling of live orders.
- **Boot assertion**: the Kraken actor verifies via `GetApiKeyInfo` that its key lacks withdrawal permission and refuses to operate otherwise ([D22](./00-decisions.md#d22)). The Alpaca actor records the structural equivalent (no transfer surface exists on its API).
- **Serialization is the point**: every private call to a venue passes through its actor, one at a time — which satisfies Kraken's nonce requirement structurally and gives one place to meter, log, and fail closed per venue.

### System cage — singleton, named `system`

The single-writer for whole-of-system limits ([Portfolio](../product/04-portfolio.md)).

- **Owns**: the total-exposure ledger (reservations by sleeve), the equity high-water mark and drawdown kill switch, venue concentration tracking, and the system mode (Running / Halted).
- **Protocol**: a sleeve must `reserve` exposure headroom before sending an order, then `commit` (on fill) or `release` (on rejection/cancel). Reservations carry the intent ID and expire if unresolved — a crashed sleeve cannot leak headroom forever. Full protocol in [Cage](./05-cage.md).
- **Halt-all**: flipping to Halted notifies every sleeve actor (best-effort, immediately) _and_ is the state every sleeve re-checks at each tick — so a missed notification delays a stand-down by at most one tick, never past it.

### Feed actor — singleton, named `feed`

The dashboard's live push channel; deliberately the least critical actor in the system.

- **Owns**: the operator's WebSocket connections (hibernation API — an idle dashboard costs nothing) and nothing else. It holds no history: the feed's record lives in Postgres, written by each event's originating actor via its outbox.
- **Receives**: best-effort `publish` calls from other actors. If a push is missed, the client re-reads the feed from Postgres on reconnect — the record is never in this actor, so this actor can be lost without losing anything.

### Flue conversation actors — in `ironcage-agents`, generated

Flue generates one DO class per agent; each conversation is an instance holding its own transcript in its own SQLite. These are Flue's machinery, not ours — we name them here only to note that they hold _conversations_, never engine state, and their contents are debugging material under the observability split ([D12](./00-decisions.md#d12)).

### Backtest container — in `ironcage-compute`

A Container-backed DO class. A gate-pipeline Workflow (or the operator, from the Workbench) starts a run; the container executes `packages/engine` — the same strategy → cage → simulated-fills code core runs ([D14](./00-decisions.md#d14)) — against pinned inputs from R2, writes results to R2/Postgres, and returns a pointer.

## The single-writer map

The reason this topology exists, in one table — each invariant has exactly one owner, and no invariant has two:

| Invariant                                          | Owner                                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| A sleeve's cage counters and tick sequence         | That sleeve's actor                                                        |
| Kraken's nonce ordering; one-at-a-time venue calls | That key's venue actor                                                     |
| Total exposure never exceeds the cap               | System cage                                                                |
| System mode (Running/Halted)                       | System cage                                                                |
| An order intent's lifecycle state                  | The intent ledger row in Postgres, advanced only by the owning venue actor |
| The permanent record of everything                 | Postgres — every actor writes, none is the record                          |

## The interleaving rule

A Durable Object's single-threading protects state between messages, **not across `await`s of external I/O** — while a venue HTTP call is in flight, other messages can interleave. So every actor that performs external I/O follows one discipline: **persist the in-flight marker first, then call out, then settle.** A sleeve marks `executing intent X` before handing it to the venue actor; the venue actor writes the intent's `submitted` state before the HTTP request leaves. Any message arriving mid-flight sees honest state and reacts (a second tick no-ops; a halt defers winddown until the in-flight call settles). This rule is restated where each flow is specified; it lives here because it is topological: it is _the_ cost of the actor model, paid everywhere I/O happens.

## Monorepo layout

([D23](./00-decisions.md#d23)) Packages are module boundaries first, build units second:

```
apps/
  app/        ironcage-app      (TanStack Start)
  core/       ironcage-core     (engine Worker: actors, workflows, queue consumer)
  agents/     ironcage-agents   (Flue application)
  compute/    ironcage-compute  (backtest container)
packages/
  domain/     Effect Schemas and the ubiquitous language — sleeve, mandate, intent,
              fill, decision record, feed event. Imported by everything; imports nothing.
  engine/     strategy → cage → simulated fills, pure and deterministic.
              Imported by core (live/dry-run) and compute (backtests) — one implementation.
  contracts/  the HttpApi definitions (AppApi, AgentReadApi), queue message schemas,
              and generated clients. The only way Workers know each other.
  ui/         shared shadcn/ui-based components for the observatory.
```

Dependency direction is one-way: `apps → contracts → domain` and `apps → engine → domain`. Nothing in `packages/` imports from `apps/`; `domain` imports nothing of ours. `engine` in particular stays free of Cloudflare and I/O — that purity is what lets one implementation serve live trading, dry run, and backtests, and what makes it trivially testable.

## Local development

Three processes, service bindings resolved by the local dev registry:

```
apps/core:   wrangler dev -c wrangler.jsonc -c ../compute/wrangler.jsonc
apps/agents: vite dev
apps/app:    vite dev
```

Core and compute share one command because a cross-Worker DO binding (`script_name`) requires it; the other two attach independently. Hyperdrive and R2 use per-binding remote bindings against real (dev-branch) resources; the container needs local Docker. One `pnpm dev` at the root runs all three.
