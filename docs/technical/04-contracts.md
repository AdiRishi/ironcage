# Contracts

Every boundary in the system, in one place: how Workers talk, who may call what, the queue that carries AI output into the record, the error taxonomy, and the idempotency and retry rules every caller shares. The problem this chapter solves is drift. Two components that each invent their own retry rule, error shape, or identifier format will eventually disagree, and they will disagree at the worst possible moment. A boundary not defined here, or in the chapter this chapter points to, does not exist. The chapter stops at the wire: what a payload means once it has arrived is the owning chapter's business.

## What this chapter guarantees

- Every cross-Worker call goes through a typed client generated from a single definition in `packages/contracts`. No hand-built fetch against an internal URL exists anywhere.
- Every payload crossing a boundary is validated by the receiver with Effect Schema, whatever the sender already checked.
- Every failure a caller can observe maps to one member of a closed error taxonomy. No stringly-typed errors cross a boundary.
- Every identifier that crosses a boundary is a UUIDv7, so any ID is time-ordered, venue-safe, and joinable anywhere.
- Every mutating flow is idempotent under a declared key. A key collision with different content is treated as a defect and raised as a critical event, never absorbed as a duplicate.
- Agents reach the rest of the system through exactly two paths: a read-only API and one queue. No mutating operation exists for them to call, and no other write path exists.
- Mutations and the live-feed upgrade are accepted only from the app's own origin, on top of the platform's access control.

## Transport

Cross-Worker communication is HTTP over service bindings. Core defines its APIs as Effect `HttpApi` values in `packages/contracts`, and callers use `HttpApiClient` against the binding's `fetch`. The result is end-to-end request and response types with schema validation on both sides, over plain HTTP.

Native Workers RPC must not be used between Workers. RPC calls ignore Smart Placement, and core's latency budget is owned by its distance to Postgres. Inside core, Durable Object stubs keep their native method calls. A DO call goes to wherever the object lives, so placement is irrelevant there.

The receiver always re-validates. A payload that arrives at core is decoded with the authoritative Schema before any handler sees it, regardless of what the sending Worker already checked. The sender's validation is a courtesy to the sender; the receiver's validation is the contract.

## Identifiers

Every identifier in the system is a UUIDv7: intents, events, records, request IDs. (Ticks are the exception with no ID at all — a tick is keyed by `(sleeve_id, candle_close_at)`, its natural identity.) One format everywhere means any ID can be logged, joined, and compared without knowing which table minted it, and the embedded timestamp makes IDs sort in creation order. The format is also venue-safe. An intent ID doubles as the venue client order ID, and Kraken's `cl_ord_id` field accepts either a UUID or at most 18 ASCII characters. A 26-character ULID fails that check, which is why ULIDs appear nowhere in this system.

Capability run IDs are the one deliberate exception: they are deterministic name-based UUIDs, not random UUIDv7s. The agent derives the run ID as a name-based UUID from the run's identity — the capability, its configuration version, and the cadence slot it answers — so a re-executed run collides with its earlier self instead of slipping past deduplication as a fresh ID. It is still a UUID and stores in the same `uuid` columns as every other ID. The derivation and its core-side validation are defined in [AI](./07-ai.md).

## Authentication at the boundary

Two different problems are solved at two different seams. The public seam (browser to app Worker) must establish who is calling. The internal seams (app to core, agents to core, core to agents) must ensure that only the intended Worker can call at all.

On the public seam, Cloudflare Access fronts the whole subdomain, and the app Worker independently verifies the Access JWT on every request. The session flow, expiry UX, and the feed socket's close semantics live in [App](./11-app.md).

Verified identity is not enough for mutations. Access authenticates the session, not the page that initiated a request: a cross-site page can cause the browser to send credentialed requests, and a WebSocket upgrade is not subject to the same-origin policy. So the server enforces an explicit check. Every mutating operation verifies the `Origin` header against the app's own origin and rejects a mismatch before any handler runs. The WebSocket upgrade performs the same check. If the check fails, the request is refused with `ValidationFailed` and nothing downstream executes.

Future non-interactive callers authenticate with Access service tokens, and a service token is authorized by an explicit audience allowlist: the Worker accepts a token only when its audience claim matches a named entry in the allowlist. The absence of a user email claim is never the test. An allowlist states what may call; an absence test merely notices what looks unusual.

The internal seams carry no tokens. A service binding is not a network route; only the bound Worker can invoke it, so possession of the binding is the authentication. The receiver still re-validates every payload, as everywhere else.

## The API surfaces

Core exposes two named surfaces. Both are defined once in `packages/contracts`. Once that package exists, the operation catalogs below are generated from its definitions; until then they are maintained by hand and the package, when written, must match them. Each operation's full request and response Schema lives with the definition.

### `AppApi` — the operator surface, called only by the app Worker

| Group         | Operations                                                                                         | Notes                                             |
| ------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Overview      | `getVitals`, `getAttentionItems`, `getEquityCurve`, `getSleeveSummaries`                           | Reads; every response carries as-of times         |
| Sleeves       | `getSleeve`, `getLivingView`, `createSleeve`, `transition`, `setPaused`                            | `transition` demands a ceremony payload           |
| Mandates      | `getMandate`, `getMandateHistory`, `proposeChange`, `applyChange`                                  | `applyChange` demands a ceremony payload          |
| Activity      | `getFeed(cursor, filters)`, `getTradeStory(correlationId)`, `acknowledge(eventId)`                 | Feed cursors are event IDs (UUIDv7, time-ordered) |
| Portfolio     | `getCapitalLedger`, `getBook`, `getCosts`, `recordCapitalAct`, `recordTransfer`, `resolveTransfer` | Acts demand ceremony payloads                     |
| Controls      | `pauseSleeve`, `flatten`, `haltSleeve`, `haltAll`                                                  | Never gated; no ceremony; confirm-only in the UI  |
| Overrides     | `armOverride`, `getOverrides`                                                                      | Arming demands the ceremony's typed phrase        |
| Money         | `import(preview/confirm)`, `getAnalysis`, `categorize`, `getRules`, `editRule`                     |                                                   |
| Reports & Tax | `listReports`, `getReport`, `getTaxEstimate`, `getTaxReport`, `runSync`                            |                                                   |
| Workbench     | `runBacktest`, `getCoverage`, `getProposals`, `decideProposal`                                     | `decideProposal` demands a ceremony payload       |

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
  runId: RunId, // deterministic name-based UUID derived from the run identity; queue dedupe key; equals capability_outputs.id
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

Delivery is at-least-once, so the consumer, not the queue, owns exactly-once semantics. On each delivery the consumer proceeds in order. First it decodes the message with the authoritative Schema; a message that fails decoding goes to the dead-letter queue. Second it checks timing: a run delivered after its capability's dispatch deadline is rejected rather than written, and the rejection is recorded ([AI](./07-ai.md) defines the deadline and validity windows). Third it validates `output` against the capability's own output Schema from the registry. Fourth it writes the output row, the decision record, and the feed event in one Postgres transaction, and the deduplication check lives inside that same transaction: the insert is keyed on the run ID, and the stored row carries a hash of the message content.

Redelivery then resolves by hash. A duplicate run ID with a matching content hash is acknowledged and dropped; that is the at-least-once queue doing what it does. The same run ID with a different content hash is never treated as a duplicate. Two executions have claimed the same identity, which means a producer is broken. The consumer refuses the write, keeps the stored original, and raises a critical event.

Messages are acknowledged individually, never as a batch, so one poison message can never re-drive its neighbors through the pipeline. A message that exhausts its delivery attempts dead-letters. A dead-lettered message becomes a `decision_record_lost` warning event on the feed: the run's evidence did not reach the record, and the operator can see that it did not.

Arrival order carries no meaning. When the engine consumes a capability's output for a tick, it selects the greatest eligible `(scheduled_at, run_id)` pair among rows whose validity window covers the evaluation. A late arrival never rewrites a completed tick. The staleness windows and consumption rules are defined in [AI](./07-ai.md).

The platform caps a queue message at 128 KiB, and that cap is the output budget. A capability output that exceeds it is a failed run, handled like any other capability failure: the safe default applies and the failure is recorded. No spillover path exists at v1. A staging pattern for oversized outputs is a recorded future option, not a built one (see Open questions).

Queue settings: batch size 1, maximum 10 delivery attempts, dead-letter queue `decision-records-dlq`, DLQ retention 14 days. All are proposed defaults owned by engine configuration.

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
| Order at the venue     | intent ID (UUIDv7) as client order ID | The venue, while the order is open; the intent ledger, always                                                                                     |
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
| queue consumer                 | 30 s per message       | Platform redelivery ×10, then DLQ                                            |

## Schema versioning

Contracts evolve additively. A new optional field ships freely. A breaking change ships as a new operation or a new message tag, and the old one is removed only after no deployed caller can still send it: callee deploys first on additions, caller first on removals. The wire seam to Flue tools mirrors these Schemas in Flue's own schema language. The mirror is wire-level convenience; core's Schema decoding remains the authoritative check ([AI](./07-ai.md)).

## Values set in this chapter

| Value                                      | Default                         | Owner                                                       | Status   |
| ------------------------------------------ | ------------------------------- | ----------------------------------------------------------- | -------- |
| app → core read timeout                    | 10 s                            | engine config                                               | proposed |
| app → core mutation timeout                | 10 s                            | engine config                                               | proposed |
| app mutation retry cap (same `request_id`) | 2                               | engine config                                               | proposed |
| agents → core timeout / retries            | 10 s; 3 attempts, exp. from 1 s | engine config                                               | proposed |
| core → agents dispatch timeout / retries   | 30 s; 3 attempts                | engine config                                               | proposed |
| core → venue call timeout                  | 10 s                            | engine config                                               | proposed |
| Postgres statement timeout                 | 15 s                            | engine config                                               | proposed |
| queue consumer per-message budget          | 30 s                            | engine config                                               | proposed |
| queue batch size / acknowledgment          | 1; individual acks              | engine config                                               | proposed |
| queue delivery attempts before DLQ         | 10                              | engine config                                               | proposed |
| DLQ retention                              | 14 days                         | engine config                                               | proposed |
| queue message size budget                  | 128 KiB                         | platform limit (register, [Operations](./12-operations.md)) | decided  |

## Alternatives considered

- **tRPC.** Rejected as redundant: Effect `HttpApi` already generates typed clients from a single definition and validates with the same Schema library the rest of the system uses.
- **One combined API surface with role checks.** Rejected: two named surfaces make "agents cannot mutate" a property of what exists, not of what is checked at runtime.
- **Native Workers RPC between Workers.** Rejected: RPC ignores Smart Placement, and core must sit near Postgres. Service bindings with typed HTTP keep placement control and lose nothing but call syntax.
- **Retry on `Ambiguous`.** Rejected everywhere: ambiguity resolves by querying, never by resending. The venue chapter owns the algorithm.
- **Silently dropping mismatched idempotency collisions.** Rejected: a same-key, different-content collision is evidence of a broken writer or a compromised boundary. Dropping it would hide exactly the defect it proves.
- **Relying on Cloudflare Access alone for mutation safety.** Rejected: Access authenticates the session, not the initiating page, and WebSocket upgrades sit outside the same-origin policy. The server-side Origin check closes both gaps.
- **An R2 staging bucket for oversized agent outputs.** Deferred, not built: it would be a second agent write path, and no v1 capability needs more than the 128 KiB message budget. An output over budget is a failed run instead.

## Open questions

1. **Does a second feed consumer ever appear?** The WebSocket frame protocol is specified in [App](./11-app.md) beside its single browser client; a second consumer would move the protocol into this chapter. Safe fallback: the protocol stays in App. Must close before: adding any non-browser feed consumer. Closed by: that consumer's concrete requirements.
2. **Do any capability outputs approach the 128 KiB message budget?** Safe fallback: an over-budget output is a failed run and the capability's safe default applies, which is fail-closed. Must close before: enabling the trade proposer in dry run, the class most likely to produce large outputs. Closed by: observed output-size distributions from dry-run capability runs; if sizes crowd the budget, the staging-bucket option is designed then, as its own decision.

## Build checklist

- [ ] `packages/contracts` with `AppApi`, `AgentReadApi`, the queue message Schema, the error union, and UUIDv7 codecs
- [ ] Catalog generation: the operation tables in this chapter produced from `packages/contracts` definitions (hand-maintained until the package exists)
- [ ] Generated clients wired through service bindings in app and agents
- [ ] Origin-check middleware on every mutating route and on the WebSocket upgrade; audience-allowlist check for service tokens
- [ ] The request-log table and `request_id` middleware for app mutations, including the collision → `Conflict` + critical-event path
- [ ] Queue consumer with in-transaction dedupe, content-hash comparison, dispatch-deadline rejection, and individual acknowledgment
- [ ] DLQ wired, with a `decision_record_lost` feed event and an attention item when it is non-empty
- [ ] Contract round-trip tests: encode → decode identity for every Schema; wire-mirror equivalence tests for Flue tool schemas
