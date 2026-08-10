# Contracts

Every boundary in the system, in one place: how Workers talk, who may call what, the queue that carries AI output into the record, the error taxonomy, and the idempotency and retry rules every caller shares. The problem this chapter solves is drift. Two components that each invent their own retry rule, error shape, or identifier format will eventually disagree, and they will disagree at the worst possible moment. A boundary not defined here, or in the chapter this chapter points to, does not exist. The chapter stops at the wire: what a payload means once it has arrived is the owning chapter's business.

## What this chapter guarantees

- Every cross-Worker call goes through a typed client generated from a single definition in `packages/contracts`. No hand-built fetch against an internal URL exists anywhere.
- Every payload crossing a boundary is validated by the receiver with Effect Schema, whatever the sender already checked.
- Every failure a caller can observe maps to one member of a closed error taxonomy. No stringly-typed errors cross a boundary.
- Every identifier that crosses a boundary is a UUIDv7, so IDs are time-ordered and joinable everywhere. A venue field uses one only after that exact venue accepts it in a conformance fixture.
- Every mutating flow is idempotent under a declared key. A key collision with different content is treated as a defect and raised as a critical event, never absorbed as a duplicate.
- Agents reach the rest of the system through exactly two paths: a read-only API and one queue. No mutating operation exists for them to call, and no other write path exists.
- Mutations and the live-feed upgrade are accepted only from the app's own origin, on top of the platform's access control.

## Transport

Cross-Worker communication is Effect RPC serialized as JSON over HTTP service bindings. Each surface is an Effect `RpcGroup` in `packages/contracts`; `RpcClient` derives the typed caller and `RpcServer` decodes and validates the same definitions on the receiving side. The package exposes three deliberate entrypoints: `@ironcage/contracts/schema` for wire values, `@ironcage/contracts/client` for callers, and `@ironcage/contracts/server` for Worker handlers. There is no catch-all package export.

The client adapter supplies the service binding's bound `fetch` as Effect's `FetchHttpClient` transport, applies the call budget while the failure is still an `HttpClientError`, and lets the RPC protocol map transport failures into `RpcClientError`. The public taxonomy folds that one protocol tag into `Internal`; it does not cast an unrelated error into the caller's error type. Abort propagation, streaming bodies, and headers remain Effect HTTP responsibilities.

On the server, the `WorkerEntrypoint` passes its `Env` and `ExecutionContext` into the Effect context for that invocation. The RPC route and handler context are constructed inside the HTTP request scope, so a handler may yield the request service without any request-specific value living at module scope. Immutable Schemas, groups, and route definitions stay module-scoped and are reused.

The service-binding conformance test runs the production core, agents, and compute Wrangler configurations in Cloudflare's test harness. It proves the real core → agents named-entrypoint call and the core → compute Durable Object binding, rather than replacing those seams with in-process functions. Requests and responses are schema-validated at both ends over ordinary HTTP.

Native Workers RPC must not be used between Workers. RPC calls ignore Smart Placement, and core's latency budget is owned by its distance to Postgres. Inside core, Durable Object stubs keep their native method calls. A DO call goes to wherever the object lives, so placement is irrelevant there.

The receiver always re-validates. A payload that arrives at core is decoded with the authoritative Schema before any handler sees it, regardless of what the sending Worker already checked. The sender's validation is a courtesy to the sender; the receiver's validation is the contract.

## Identifiers

Every identifier in the system is a UUIDv7: intents, events, records, and request IDs. Ticks have no ID; `(sleeve_id, candle_close_at)` is their natural identity. One format lets any identifier be logged, joined, and compared without knowing which table minted it. Its embedded timestamp also preserves creation order.

An intent ID is proposed as the venue client order ID. Kraken documents a generic UUID form, but not version 7 specifically. Alpaca documents a unique client ID without promising retry idempotency. The launch fixtures in [Venues](./06-venues.md) must prove field acceptance. The intent ledger, not the venue field, owns deduplication.

Capability run IDs are the one deliberate exception: they are deterministic name-based UUIDs, not random UUIDv7s. The agent derives the run ID as a name-based UUID from the run's identity — the capability, its configuration version, and the cadence slot it answers — so a re-executed run collides with its earlier self instead of slipping past deduplication as a fresh ID. It is still a UUID and stores in the same `uuid` columns as every other ID. The derivation and its core-side validation are defined in [AI](./07-ai.md).

## Authentication at the boundary

Two different problems are solved at two different seams. The public seam (browser to app Worker) must establish who is calling. The internal seams (app to core, agents to core, core to agents) must ensure that only the intended Worker can call at all.

On the public seam, Cloudflare Access fronts the whole subdomain, and the app Worker independently verifies the Access JWT on every request. The session flow, expiry UX, and the feed socket's close semantics live in [App](./11-app.md).

Verified identity is not enough for mutations. Access authenticates the session, not the page that initiated a request: a cross-site page can cause the browser to send credentialed requests, and a WebSocket upgrade is not subject to the same-origin policy. So the server enforces an explicit check. Every mutating operation verifies the `Origin` header against the app's own origin and rejects a mismatch before any handler runs. The WebSocket upgrade performs the same check. If the check fails, the request is refused with `ValidationFailed` and nothing downstream executes.

Future non-interactive callers authenticate with Access service tokens. The Worker first verifies signature, issuer, expiry, and the expected Access-application `aud`; that audience identifies the application, not the machine caller. It then authorizes the caller by an exact allowlist of service-token Client IDs carried in the application token's `common_name` claim. The Access policy selects the same tokens as defense in depth. The absence of a user email claim is never the test.

The internal seams carry no tokens. A service binding is not a network route; only the bound Worker can invoke it, so possession of the binding is the authentication. The receiver still re-validates every payload, as everywhere else.

## The API surfaces

Core exposes two named surfaces. Both are defined once in `packages/contracts`. The operation catalogs below are the normative surface specification, and each implemented operation carries its full request, success, and error Schema in the corresponding `RpcGroup`.

### `AppApi` — the operator surface, called only by the app Worker

| Group         | Operations                                                                                                                                                                        | Notes                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Overview      | `getVitals`, `getAttentionItems`, `getEquityCurve`, `getSleeveSummaries`                                                                                                          | Reads; every response carries as-of times                                 |
| Sleeves       | `getSleeve`, `getLivingView`, `createSleeve`, `transition`, `setPaused`                                                                                                           | `transition` demands a ceremony payload                                   |
| Mandates      | `getMandate`, `getMandateHistory`, `proposeChange`, `applyChange`                                                                                                                 | `applyChange` demands a ceremony payload                                  |
| Activity      | `getFeed(cursor, filters)`, `getTradeStory(correlationId)`, `acknowledge(eventId)`                                                                                                | Feed cursors are event IDs (UUIDv7, time-ordered)                         |
| Portfolio     | `getCapitalLedger`, `getBook`, `getCosts`, `recordCapitalAct`, `recordTransfer`, `resolveTransfer`                                                                                | Acts demand ceremony payloads                                             |
| Controls      | `pauseSleeve`, `flatten`, `haltSleeve`, `haltAll`                                                                                                                                 | Never gated; no ceremony; confirm-only in the UI                          |
| Overrides     | `armOverride`, `getOverrides`                                                                                                                                                     | Arming demands the ceremony's typed phrase                                |
| Money         | `previewBankImport`, `confirmBankImport`, `getImportHistory`, `getBankCoverage`, `getMoneyAnalysis`, `categorizeTransactions`, `getCategorizationRules`, `editCategorizationRule` | Preview and confirm resend source bytes; analysis carries coverage status |
| Reports & Tax | `listReports`, `getReport`, `getTaxEstimate`, `getTaxReport`, `runSync`                                                                                                           |                                                                           |
| Workbench     | `runBacktest`, `getCoverage`, `getProposals`, `decideProposal`                                                                                                                    | `decideProposal` demands a ceremony payload                               |

Two rules bind the surface. First, risk-reducing controls never require a ceremony payload, and they must be accepted even when every other operation is failing. Second, every mutating operation is idempotent under a client-supplied `request_id` (UUIDv7), so the app may safely retry any timeout.

### `AgentReadApi` — the AI's window, called only by the agents Worker

| Operations                                       | Purpose                                    |
| ------------------------------------------------ | ------------------------------------------ |
| `getCandles(instrument, timeframe, window)`      | Market context                             |
| `getPositions(sleeve)`, `getSleeveState(sleeve)` | Book context                               |
| `getMandateDocument(sleeve)`                     | The rules the AI is advising under         |
| `getScorecard(capability)`                       | Its own track record                       |
| `getFeedSlice(filters)`                          | Recorded events, for observers and reports |
| `getCoverage()`, `getBacktestResult(run)`        | Workbench context for design-time agents   |

No mutating operation exists on this surface, and that absence is the enforcement: agents cannot mutate because there is nothing to call. Adding a mutating operation would change the seam itself. It requires a deliberate product decision, not a feature request.

## The queue contract

Agents have exactly two paths to the rest of the system: the read-only `AgentReadApi` above, and the `decision-records` queue. The queue is the only write path from agents to core. It accepts exactly one message shape, and nothing an agent sends takes effect until core has re-validated and persisted it. There is no agent write path to R2 or to any other store.

One message per capability run:

```ts
// packages/contracts/src/queue.ts
export const CapabilityRunMessage = Schema.Struct({
  runId: RunId, // application idempotency key backed by capability_outputs.id; Queues itself does not dedupe on it
  capability: Schema.String, // registry name
  sleeveId: Schema.NullOr(SleeveId), // UUIDv7
  configVersion: Schema.Number,
  scheduledAt: Schema.Instant, // the cadence slot this run answers; anchors staleness and ordering
  producedAt: Schema.Instant,
  result: Schema.Union(
    Schema.Struct({ _tag: Schema.Literal("Output"), output: Schema.Unknown }), // re-validated by core
    Schema.Struct({ _tag: Schema.Literal("Failed"), failure: FailureDetail }),
  ),
  decisionRecord: DecisionRecordBody, // asked, inputs summary, decided, rationale, model, gateway log IDs
});
```

[Queues delivery is at-least-once](https://developers.cloudflare.com/queues/reference/delivery-guarantees/), so the consumer owns exactly-once application semantics. It handles each delivery in four steps.

1. Decode the message with the authoritative Schema. A decode failure follows the configured retry path. [Native dead-letter routing occurs only after those retries are exhausted](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/).
2. Check timing. A run delivered after its capability's dispatch deadline is rejected and recorded rather than written. [AI](./07-ai.md) defines the deadline and validity windows.
3. Validate `output` against the capability's registered output Schema.
4. Write the output row, decision record, and feed event in one Postgres transaction. The run ID keys the insert, and the stored row carries a hash of the message content. This places the deduplication check inside the same transaction.

Redelivery then resolves by hash. A duplicate run ID with a matching content hash is acknowledged and dropped; that is the at-least-once queue doing what it does. The same run ID with a different content hash is never treated as a duplicate. Two executions have claimed the same identity, which means a producer is broken. The consumer refuses the write, keeps the stored original, and raises a critical event.

The consumer batch size is one, so acknowledgement and retry apply to one run at a time. A message that exhausts its delivery attempts is routed to `decision-records-dlq`. That queue has its own idempotent consumer: it persists a `decision_record_lost` warning and attention item keyed by the failed message ID, then acknowledges the DLQ message. Merely configuring a DLQ does not execute that application logic.

Arrival order carries no meaning. When the engine consumes a capability's output for a tick, it selects the greatest eligible `(scheduled_at, run_id)` pair among rows whose validity window covers the evaluation. A late arrival never rewrites a completed tick. The staleness windows and consumption rules are defined in [AI](./07-ai.md).

[The platform caps a queue message at 128,000 bytes](https://developers.cloudflare.com/queues/platform/limits/). Ironcage caps the complete serialized envelope at **120,000 bytes** (proposed), leaving room below the platform boundary. A capability envelope that exceeds it is a failed run, handled like any other capability failure: the safe default applies and the failure is recorded. No spillover path exists at v1. A staging pattern for oversized outputs is a recorded future option, not a built one (see Open questions).

Queue settings: batch size 1, `max_retries = 9` for ten total delivery attempts (the initial delivery plus nine retries), dead-letter queue `decision-records-dlq`, DLQ retention 14 days. All are proposed defaults owned by engine configuration.

## Error taxonomy

Every boundary error is one of these tags. Callers match on the tag; nothing matches on message text. The tags travel as one error union in `packages/contracts`, so a new failure mode must either map to an existing tag or amend the union deliberately.

| Tag                | Meaning                                                          | Caller's correct reaction                                         |
| ------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| `ValidationFailed` | Payload failed Schema decoding, or an origin check failed        | Do not retry; this is a defect                                    |
| `NotFound`         | Named entity doesn't exist                                       | Do not retry                                                      |
| `CeremonyRequired` | Mutation attempted without its ceremony payload                  | Surface the ceremony                                              |
| `Conflict`         | Idempotent replay with a different payload, or a stale version   | Re-read, then decide; the receiver has already raised the defect  |
| `Stale`            | The requested read cannot be served fresh (gap, degraded source) | Render the stale state as stale                                   |
| `VenueUnreachable` | Venue call failed before any order could exist                   | Retry per policy; fail closed on exhaustion                       |
| `VenueRejected`    | The venue refused a well-formed order                            | Do not retry; record the verdict                                  |
| `Ambiguous`        | An external call's outcome is unknown                            | Resolve by query, never by blind retry ([Venues](./06-venues.md)) |
| `CageRejected`     | The cage refused the action                                      | Never retried; the verdict is the answer                          |
| `Halted`           | The sleeve or system is halted                                   | Stop; only an operator changes this                               |
| `Internal`         | Anything else                                                    | Retry per policy; page via vitals on persistence                  |

## Idempotency registry

Each flow's key and dedupe boundary, in one table. These are the only idempotency mechanisms in the system; a new flow must add its row here before it ships.

| Flow                   | Key                                   | Deduped by                                                                                                                                        |
| ---------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tick execution         | `(sleeve_id, candle_close_at)`        | The Postgres `ticks` table, written in the decision transaction; the actor's copy is a cache                                                      |
| Order at the venue     | intent ID (UUIDv7) as client order ID | The intent ledger, always. Venue lookup supplies reconciliation evidence but is not treated as a documented dedupe/idempotency boundary           |
| Outbox effect delivery | `pending_effects` row ID              | The drainer's delivered mark; a crash between send and mark may repeat the effect, and every effect carried (the halt email) tolerates repetition |
| AI run ingestion       | run ID                                | `capability_outputs` primary key plus content hash, checked inside the write transaction                                                          |
| App mutations          | client `request_id` (UUIDv7)          | A request-log table with a unique key, checked in the mutation's transaction                                                                      |
| Venue fill ingestion   | `(intent_id, venue_fill_id)`          | The fills table's unique constraint                                                                                                               |
| Workflow steps         | `(workflow instance, step name)`      | The platform's step cache, plus receipts in Postgres                                                                                              |

One rule governs every row of this table. An idempotency key exists so that the same work, retried, collapses into one effect. When a key collides but the content differs — the same `request_id` with a different payload, the same run ID with a different hash, the same fill key with different quantities — that is not a retry. Two different facts have claimed one identity, which means a writer is broken or a boundary is compromised. The receiver keeps the stored original, refuses the colliding write, returns `Conflict` where a caller is waiting, and raises a critical event. A collision is never absorbed silently, because a silently absorbed collision hides the defect that produced it.

## Timeouts and retries, consolidated

The tick and venue chapters set their own interior values; this table is the cross-boundary summary so no caller invents its own. All values are proposed defaults owned by engine configuration.

| Call                           | Timeout                | Retry policy                                                                 |
| ------------------------------ | ---------------------- | ---------------------------------------------------------------------------- |
| app → core (reads)             | 10 s                   | None; the UI renders the failure                                             |
| app → core (mutations)         | 10 s                   | Safe to retry with the same `request_id`, max 2                              |
| agents → core (`AgentReadApi`) | 10 s                   | 3 attempts, exponential from 1 s                                             |
| core → agents (dispatch)       | 30 s                   | 3 attempts; a failed dispatch is a missed run, visible in vitals             |
| core → venue (all calls)       | 10 s                   | Never blindly for orders (the `Ambiguous` path); 3 attempts for reads        |
| core → Postgres                | 15 s statement timeout | Reads: 3 attempts. Writes: retried only via the outbox or an idempotency key |
| queue consumer                 | 30 s per message       | Initial delivery + 9 retries, then DLQ                                       |

## Schema versioning

Contracts evolve additively. One main-branch release deploys every Worker, but those deploys are not a distributed transaction and a short mixed-commit interval remains. A new field is therefore optional through the release that introduces it. A breaking change uses a new operation or message tag; the old form is removed in a later whole-system release after production proves the new path. The wire seam to Flue tools mirrors these Schemas in Flue's own schema language. The mirror is wire-level convenience; core's Schema decoding remains the authoritative check ([AI](./07-ai.md)).

## Values set in this chapter

| Value                                      | Default                         | Owner                    | Status             |
| ------------------------------------------ | ------------------------------- | ------------------------ | ------------------ |
| app → core read timeout                    | 10 s                            | engine config            | proposed           |
| app → core mutation timeout                | 10 s                            | engine config            | proposed           |
| app mutation retry cap (same `request_id`) | 2                               | engine config            | proposed           |
| agents → core timeout / retries            | 10 s; 3 attempts, exp. from 1 s | engine config            | proposed           |
| core → agents dispatch timeout / retries   | 30 s; 3 attempts                | engine config            | proposed           |
| core → venue call timeout                  | 10 s                            | engine config            | proposed           |
| Postgres statement timeout                 | 15 s                            | engine config            | proposed           |
| queue consumer per-message budget          | 30 s                            | engine config            | proposed           |
| queue batch size / acknowledgment          | 1; individual acks              | engine config            | proposed           |
| queue retries / total attempts before DLQ  | 9 / 10                          | engine config            | proposed           |
| DLQ retention                              | 14 days                         | engine config            | proposed           |
| queue platform / envelope size             | 128,000 / 120,000 bytes         | platform / engine config | decided / proposed |

## Alternatives considered

- **tRPC.** Rejected as redundant: Effect RPC already derives typed clients and servers from one `RpcGroup` and validates with the same Schema library the rest of the system uses.
- **One combined API surface with role checks.** Rejected: two named surfaces make "agents cannot mutate" a property of what exists, not of what is checked at runtime.
- **Native Workers RPC between Workers.** Rejected: RPC ignores Smart Placement, and core must sit near Postgres. Service bindings with typed HTTP keep placement control and lose nothing but call syntax.
- **Retry on `Ambiguous`.** Rejected everywhere: ambiguity resolves by querying, never by resending. The venue chapter owns the algorithm.
- **Silently dropping mismatched idempotency collisions.** Rejected: a same-key, different-content collision is evidence of a broken writer or a compromised boundary. Dropping it would hide exactly the defect it proves.
- **Relying on Cloudflare Access alone for mutation safety.** Rejected: Access authenticates the session, not the initiating page, and WebSocket upgrades sit outside the same-origin policy. The server-side Origin check closes both gaps.
- **An R2 staging bucket for oversized agent outputs.** Deferred, not built: it would be a second agent write path, and no v1 capability needs more than the 120,000-byte envelope budget. An output over budget is a failed run instead.

## Open questions

1. **Does a second feed consumer ever appear?** The WebSocket frame protocol is specified in [App](./11-app.md) beside its single browser client; a second consumer would move the protocol into this chapter. Safe fallback: the protocol stays in App. Must close before: adding any non-browser feed consumer. Closed by: that consumer's concrete requirements.
2. **Do any capability outputs approach the 120,000-byte envelope budget?** Safe fallback: an over-budget output is a failed run and the capability's safe default applies, which is fail-closed. Must close before: enabling the trade proposer in dry run, the class most likely to produce large outputs. Closed by: observed serialized-envelope size distributions from dry-run capability runs; if sizes crowd the budget, the staging-bucket option is designed then, as its own decision.

## Build checklist

- [ ] Complete `AppRpcs`, `AgentReadRpcs`, the queue message Schema, the error union, and UUIDv7 codecs in `packages/contracts`
- [ ] Catalog generation: produce the operation tables in this chapter from the `RpcGroup` definitions
- [x] Generated clients wired through service bindings in app, core, and agents, with a real multi-Worker conformance test
- [ ] Origin-check middleware on every mutating route and on the WebSocket upgrade; expected application `aud` plus exact service-token `common_name` allowlist
- [ ] The request-log table and `request_id` middleware for app mutations, including the collision → `Conflict` + critical-event path
- [ ] Queue consumer with in-transaction dedupe, content-hash comparison, dispatch-deadline rejection, and individual acknowledgment
- [ ] DLQ consumer wired, with idempotent `decision_record_lost` feed and attention writes; test poison-message retries and final DLQ delivery
- [ ] Contract round-trip tests: encode → decode identity for every Schema; wire-mirror equivalence tests for Flue tool schemas
