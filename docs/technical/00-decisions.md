# Decisions

The decision log. Every load-bearing technical choice lives here with its reasoning and what was rejected, so nothing agreed in conversation exists only in conversation. Entries are append-mostly: a reversed decision gets a new entry that names the one it supersedes, not a silent edit — the same discipline the product applies to mandates.

Format: what was decided · why · what was rejected and why. Status is **adopted** unless marked **deferred** (deliberately parked, nothing depends on it yet). All entries 2026-08, iteration phase.

## Foundation

<a name="d1"></a>**D1 — Effect V4 for all engine and domain code.**
TypeScript throughout, with Effect V4 (currently in beta) as the core library: services and layers for dependency injection, Schema for every boundary (order intents, venue responses, AI outputs, config), typed errors, retry/schedule combinators, structured concurrency. The exact beta version is pinned; upgrades are deliberate acts. The vendored repository at `.repos/effect` is ground truth over web documentation, which lags the beta. Domain code depends on our own service interfaces; Effect's platform modules are used inside those services' implementations — which is ordinary Effect architecture, and also localizes any beta-churn to thin adapters.
_Rejected_: Effect V3 (stable, but its Schema migration to V4 would be the expensive part later — greenfield should start where we intend to live); plain TypeScript (loses typed DI, Schema, and structured error handling that this system's correctness leans on).

<a name="d2"></a>**D2 — Cloudflare as the runtime platform.**
Workers, Durable Objects, Workflows, Queues, Containers, R2, AI Gateway, Flagship — the whole engine runs on the Cloudflare developer platform, deployed to the operator's personal account. The platform has no "always-on process," and the architecture embraces that: Durable Object alarms for the heartbeat, Workflows for anything spanning hours to days, Containers for heavy compute, hibernating DOs for connection state.
_Rejected_: a VPS or container host running a long-lived process (more operational surface for one operator: patching, monitoring, restarts — the platform's managed primitives replace all of it); AWS/GCP serverless (no equivalent of Durable Objects' single-writer actors, which the cage design leans on structurally).

<a name="d3"></a>**D3 — PlanetScale Postgres as the system of record, via dual Hyperdrive configurations.**
Real Postgres (v18), HA tier, reached from Workers through Cloudflare Hyperdrive using `@effect/sql-pg`. Money is stored as `NUMERIC` — exact, never floating point. Two Hyperdrive configurations point at the same database, bound side by side — the pattern Cloudflare's query-caching docs recommend: the **default binding has caching disabled** (Hyperdrive's cache is never invalidated by writes, so any read-after-write through it would be wrong), and a second **cached binding** serves staleness-tolerant reads — dashboard aggregates, analytics. Uncached-as-default is deliberate: reaching for the cached binding is an opt-in, per-call-site choice, so nobody gets a stale position by forgetting. Each configuration holds its own origin connection pool; pool sizes are tuned down to respect the small database. Schema migrations are ours (PlanetScale's Postgres product has no deploy-request workflow); the weekly maintenance window and 1–2 s failovers make retry logic mandatory, which fail-closed design wants anyway.
_Rejected_: Cloudflare D1 (SQLite has no exact numeric type — disqualifying for a ledger — plus no CDC and a 10 GB ceiling); Neon (scale-to-zero cold starts on the trading path); Supabase (a full BaaS surface when only a database is needed).

## Runtime shape

<a name="d4"></a>**D4 — Cloudflare Workflows for durable pipelines, Effect inside each step.**
Anything spanning hours to days — the gate pipeline, tax syncs, report generation — runs as a Cloudflare Workflow: per-step retries, sleeps up to a year, `waitForEvent` for operator approval. Step bodies are Effect programs. Workflows are orchestration, never record: completed-instance state is retained only 30 days and step results cap at 1 MiB, so every step writes its real output to Postgres/R2 and returns only a pointer (the receipt discipline, [Data](./03-data.md)).
_Rejected for now_: Effect's own Workflow/Cluster (wants long-lived runners and its own message storage — architecturally a competitor to the platform, and younger; revisit if it matures toward serverless).

<a name="d5"></a>**D5 — Actor-per-sleeve topology.**
One Durable Object per sleeve (its cage state, strategy state, and tick alarm), one per venue API key (serialized venue calls), one system-cage object, one feed object for the dashboard. The single-writer property that makes cage checks race-free comes from the platform's actor model, not from locks. Detail in [Topology](./02-topology.md).
_Rejected_: one engine DO running all sleeves (total coupling — one slow venue call stalls every sleeve; whole-engine blast radius; contradicts sleeves-as-isolated-tenants); database-centric with stateless Workers and row locks (single-writer by lock instead of by structure; a cage check spanning a venue HTTP call must either hold a lock across the network or split and re-check — both bad).

<a name="d6"></a>**D6 — Self-rescheduling Durable Object alarms are the authoritative tick; cron is only a watchdog.**
DO alarms are the one Cloudflare scheduling primitive with a documented reliability guarantee (at-least-once, automatic retries with backoff). Each sleeve DO arms its own next alarm in the same transaction as recording the current tick. A low-frequency Cron Trigger acts as a watchdog that detects and re-arms a dead alarm — cron carries no documented delivery guarantee and is never the authority. At-least-once delivery means every tick handler is idempotent, keyed on `(sleeve, candle_close_ts)`.
_Rejected_: Cron Triggers as the primary tick (no reliability guarantee for a component that moves money).

<a name="d7"></a>**D7 — Polling-first market data; no persistent venue WebSockets in v1.**
Decisions happen only at candle boundaries (mandate cadence, never sub-minute), so the engine polls closed candles per tick rather than holding streams. Streams on this platform are a reconnect state machine (outbound connections pin a DO for at most 15 minutes; Kraken idles out at ~60 s) bought for data the engine discards — and polling makes staleness trivially detectable, which fail-closed wants. Intra-candle protection comes from venue-resident stop orders, not from us watching a stream. Order status is burst-polled for the short life of an order. Streaming returns only as a recorded decision with evidence of need (Alpaca's SSE event stream with cursor resume is the candidate; Kraken's WebSocket cannot replay).
_Consequence_: the engine keeps its own candle store — mandatory anyway, since Kraken's OHLC endpoint returns only the most recent 720 candles ever; deeper history is seeded from Kraken's published CSV archives as recorded backfill acts ([Workbench](./07-workbench.md)).

<a name="d8"></a>**D8 — The intent ledger owns idempotency; venues are assumed to provide none.**
Neither venue's client order ID is a durable idempotency key (both enforce uniqueness only against *open* orders). So: every order intent is persisted before the venue call; any ambiguous outcome (timeout, 5xx) resolves by querying the venue for the client order ID and only then deciding to retry — query-then-post, never blind retry. Every Kraken order carries the `deadline` parameter so a stale retry is rejected server-side. All private Kraken calls serialize through that key's venue DO, which also satisfies Kraken's strictly-increasing-nonce requirement structurally.

<a name="d9"></a>**D9 — Data layering: Postgres is the record, DO state is a rebuildable projection, R2 holds blobs.**
The blotter, ledgers, mandates, decision records, and tax events live in Postgres — permanent and authoritative. Each Durable Object's SQLite holds only hot working state, and every byte of it must be rebuildable from Postgres: the vision's "recompute from the record, never trust memory" applied to the runtime itself. R2 holds artifacts: raw exports, backtest outputs, report bodies, candle archives. DO SQLite is never used as an append log (it is the platform's most expensive write, and it isn't the record).

## AI

<a name="d10"></a>**D10 — Flue is the framework for all AI code — including simple scheduled calls.**
Every capability, from the 4-hourly regime check to multi-step research agents, is written as a Flue agent in a dedicated Worker (`ironcage-agents`), separate from the engine (`ironcage-core`), connected by a service binding. Rationale for "all," not "agentic only": a simple question-and-answer capability may grow skills, context, or follow-up judgment, and starting in Flue means growth never requires migration — a Flue agent can stay a plain Q&A wrapper indefinitely. The safety boundary does not move with this choice: agents produce output; the engine validates it against Schema and applies the reduce-only clamp before it means anything ([Cage](./05-cage.md), [AI](./06-ai.md)). Flue's version is pinned exactly, same posture as Effect.
_Rejected_: direct model calls for the simple capabilities (my initial recommendation — overruled for the growth argument above); Cloudflare's Think harness (Flue occupies this role; Think is a competing harness Flue doesn't use).

<a name="d11"></a>**D11 — All model traffic through AI Gateway; models are versioned per-capability configuration.**
Every model call from every agent routes through Cloudflare AI Gateway — spend caps, per-capability cost attribution, caching, logging. Flue's providers must be explicitly configured with the gateway's URL (its defaults ship straight to the provider), a one-time setup this spec treats as mandatory. Which model a capability uses is configuration versioned like everything else — fully swappable, no code change. Provider/model selection per capability is **deferred** (D21).

<a name="d12"></a>**D12 — Decision records are ours forever; deep AI observability is delegated to the platform.**
What Ironcage stores permanently, per AI decision: what was asked, what data mattered, what was decided, why, when, by which model — one record, in Postgres, rendered in the Activity feed, with the AI Gateway log ID attached. Turn-by-turn agent internals (every intermediate prompt and tool call) are AI Gateway's and the Agents dashboard's job — debugging material, count-capped retention, not part of the permanent record. Our record IDs are stamped onto the platform's traces so the two link.
_Consequence_: the product Activity doc's trace-viewer language predates this decision and needs a deliberate edit — the permanent promise is the decision and its reasoning, not raw transcripts.

## Proving & shipping

<a name="d13"></a>**D13 — The gate pipeline is raw Workflows + Containers + Artifacts.**
Each gate (schema validation, reproducible backtest, walk-forward, shadow comparison, operator approval) is a typed Workflow step; backtest compute runs in Containers; AI-proposed strategy diffs are committed to Cloudflare Artifacts so every proposal is an immutable, addressable commit whose push event can trigger the pipeline.
_Rejected_: `@cloudflare/ci` (its unit of work is a shell command in a sandbox — wrong shape for typed domain gates, and its logs are not secret-redacted).

<a name="d14"></a>**D14 — Backtests run the real engine code.**
The product spec requires backtests to run the same `strategy → cage → simulated fills` path as live trading. Therefore backtests execute our TypeScript engine in a Container — never a parallel implementation in another language, whatever the numeric-library temptations. A second implementation would be a second truth, which the spec forbids.

<a name="d15"></a>**D15 — Flagship for kill switches and modes; mandates live only in Postgres.**
Feature flags hold exactly two kinds of state: the system-level and per-sleeve trading kill switches, and each sleeve's mode (`shadow`/`dry-run`/`live`) — flippable in seconds without a deploy, evaluated locally with zero added latency, with the flag service's own change log as a secondary audit trail. Mandates, allocations, and anything with domain meaning stay in Postgres; a flag never stores what a mandate owns. Worker deploys use versioned upload → verify → deploy with instant rollback (percentage canarying is meaningless at one operator's traffic).

<a name="d16"></a>**D16 — Cloudflare Computer workspaces for design-time agents only.**
Research and calibration agents get a durable workspace (files, git, code execution) as a standard tool — useful for exploratory analysis that shouldn't round-trip through the gate pipeline. Its lighter Worker-based execution backends are preferred; the container backend and any use on the run-time trading path are excluded. It is preview-grade software behind a narrow interface we can remove.

<a name="d17"></a>**D17 — Agent-security apparatus: considered and rejected.**
Several patterns from Cloudflare's agent-security work were reviewed — tiered approval gates, action simulation, and an egress allowlist restricting the core Worker's outbound connections (proposed as a defense against supply-chain-compromised dependencies). All **rejected** by the operator as overcomplication: supply-chain compromise is not a threat this project designs against, and the product's existing control model stands as-is — risk-reducing actions always available, risk-increasing changes through the mandate ceremony. Recorded so the consideration isn't re-litigated from scratch.

## Workers & communication

<a name="d23"></a>**D23 — Four Workers, one monorepo.**
`ironcage-app` (TanStack Start), `ironcage-core` (the engine: every Durable Object class, Workflows, Hyperdrive, cron — no AI code), `ironcage-agents` (the Flue application), `ironcage-compute` (the backtest Container). The boundaries are mostly forced: TanStack Start and Flue each own their Worker's build entry; Durable Object classes live in exactly one Worker; a Container image build couples to its Worker's deploy — split out so core, the money-touching Worker, deploys fast and rolls back instantly without waiting on a Docker build. The app Worker holds exactly one binding (to core): no database, no venue keys, no Durable Objects. Within the monorepo, shared code is split into packages with deliberate module boundaries — `domain` (Schemas, the ubiquitous language), `engine` (strategy → cage → simulated fills, imported by both core and compute so backtests run the real code), `contracts` (typed API definitions), `ui` — boundaries drawn for clean design, not build convenience.

<a name="d24"></a>**D24 — Cross-Worker communication is typed HTTP over service bindings; native Workers RPC is not used between Workers.**
Workers RPC is incompatible with Smart Placement (placement is ignored for RPC calls), and keeping placement options open matters for Workers whose latency is dominated by distance to Postgres. The RPC *developer experience* is kept without the mechanism: core defines its API as an Effect `HttpApi`, and every caller — app server functions, agents — uses the generated typed client over the service binding: end-to-end request/response types and schema validation, transported as plain HTTP. tRPC was considered and rejected as redundant with `HttpApi`. Inside core, Durable Object stubs keep their native method calls — a DO call goes to wherever that object lives, so the placement concern doesn't apply. The agents Worker is bound only to a **read-only API surface** on core, which makes "agents return data, never actions" wiring rather than convention.

<a name="d25"></a>**D25 — Reliability: synchronous-first; the outbox pattern where a Durable Object must guarantee an effect; exactly one Queue.**
A direct call that fails is an error to handle — with Effect's declarative retry policies — not a reason to turn a synchronous mental model asynchronous. Where a Durable Object must guarantee something *eventually* happens (flushing feed events to Postgres, sending the halt email), it writes the obligation into its own storage in the same transaction as the work, and its alarm retries delivery: the outbox pattern — the same at-least-once guarantee as a queue, with the pending work inspectable where it belongs. Cloudflare Queues appear in exactly one place: **agents → core delivery of decision records**, where the producer is a stateless Worker with no durable home for an outbox; the queue provides buffering, retries, and dead-letter capture across that seam. The order path is never queued: at-least-once *and unordered* are precisely the wrong properties for orders.

## Product surfaces

<a name="d18"></a>**D18 — TanStack Start for the web application.**
The observatory is a TanStack Start app served from the platform, talking to the core API and the feed DO's WebSocket. Chosen by the operator over a plain Vite SPA and Next.js.

<a name="d26"></a>**D26 — Frontend interaction model and component base.**
Reads and writes: TanStack Start server functions calling core's typed client over the service binding, with TanStack Query for caching and invalidation. The live feed: a server function mints a short-lived ticket, and the browser opens a WebSocket through the app Worker to the feed DO (browsers can't attach auth headers to WebSockets; the ticket pattern is the standard answer). AI surfaces: Flue's own client and React hooks (`@flue/sdk`, `@flue/react`) — streaming, resumable, SSR-safe; Vercel's AI SDK is **not** used (Flue's client neither needs nor speaks it). Components are not reinvented: **shadcn/ui** is the base component kit, and **Vercel AI Elements** (copy-in, dependency-free components) supply the chat/AI chrome where useful — effort goes into the observatory's substance, not into buttons and inputs.

<a name="d19"></a>**D19 — The one interruption arrives by email** (for now). No bot infrastructure exists yet; a push channel can replace it later as its own small decision.

<a name="d20"></a>**D20 — Deployment target: the operator's personal Cloudflare account, on a subdomain of an existing domain.** A dedicated domain is unnecessary for a private, authenticated, single-operator app and can be adopted later without consequence.

## Venue facts recorded as constraints

<a name="d22"></a>**D22 — The no-withdrawal guarantee is provable on Kraken, structural on Alpaca.**
Kraken: the API key is created without withdrawal permission, and the engine asserts this at boot via `GetApiKeyInfo` — refusing to start if the permission is present. Alpaca: no scoped keys and no equivalent introspection exist; the protection is that the Trading API has no funds-transfer surface at all (transfers live in the separate Broker API). The asymmetry is documented rather than papered over: residual Alpaca key risk is unauthorized trading/liquidation, not exfiltration.
Also recorded: AUD funds Kraken natively (PayID/Osko, free; native BTC/AUD and ETH/AUD pairs — no USD leg), while Alpaca is funded only by USD international wire — deposits sized to amortize wire cost, and each AUD→USD conversion is itself a tax event.

## Deferred

<a name="d21"></a>**D21 — Deferred decisions.** Auth mechanism (Clerk vs Cloudflare Access — nothing designed so far depends on the choice); provider/model selection per capability (D11 makes it swappable configuration, so it can wait); any notification channel beyond email (D19); streaming market data (D7's recorded re-entry path).
