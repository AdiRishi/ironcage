# Operations

This chapter covers how Ironcage is developed, deployed, tested, watched, and recovered: the two environments, the monorepo, secrets, the deploy runbook, migrations, the test suites, vitals, backups, and the platform-assumption register. There is one operator, so every procedure here is designed to be routine, recorded, and reversible. The chapter stops at the machinery of running the system; what the system does when it runs is the business of chapters 01 through 11.

## What this chapter guarantees

- A deploy is an ordinary restart. Shipping while positions are open requires no special care, because a deploy restarts Durable Objects, and that is the crash the engine already survives.
- Core is never verified against a preview URL, because preview URLs do not exist for Workers that implement Durable Object classes. Core is verified after promotion, behind a temporary block on new entries.
- No flag can start, resume, or loosen anything. Flagship holds kill switches only; mode and lifecycle live in Postgres behind the ceremony.
- A restore is proven, not assumed. A scheduled restore test converts the backup from a guess into a fact, and a restore never replays obligations recorded before the restore point.
- A dead core is detected from outside core. An external dead-man monitor watches a signed health route, because vitals, the feed, and the halt-email outbox all live inside core.
- Local development can never hold a trade-capable venue key. Core asserts this at boot and refuses to start.
- Every production deploy is in the feed, carrying the Worker and its version ID, so "what changed before this incident?" is a query.
- Every externally sourced platform fact in this specification carries its source and a review date, in the register at the end of this chapter.

## 1. Two environments

There are exactly two: local development and production. There is no staging tier, and adding one would be a mistake for two reasons.

**Dry run is the staging environment for strategies.** A strategy proves itself against live market data with simulated fills, which is stronger evidence than a second environment produces.

**Versioned deploys are the staging environment for code.** A version is uploaded, promoted, verified, and rolled back in minutes. A parallel environment would double the operational surface and test nothing dry run does not test better.

Local never holds trade-capable venue keys. Core asserts this at boot: if `ENVIRONMENT` is `local` and any venue credential carries trade permission, the Worker refuses to start. Kraken's `validate: true` order flag still requires an order-capable key, so there is no such thing as a safe local Kraken order credential. Local order-shape work therefore uses recorded fixtures, and the validate-only checks run against a remote test harness that holds the credential and never releases it to local code (**VERIFY:** confirm against Kraken's API documentation that no validate-only permission scope exists).

| Worker             | Binding or secret                                | Local                                     | Production                                                |
| ------------------ | ------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------- |
| `ironcage-app`     | `CORE` service binding                           | local dev registry                        | `ironcage-core`                                           |
| `ironcage-app`     | `AGENTS` service binding                         | local dev registry, conversations only    | `ironcage-agents`, conversations only                     |
| `ironcage-app`     | `ACCESS_AUD` (config)                            | unset; Access not in front                | the Access application's tag                              |
| `ironcage-core`    | `DB` (Hyperdrive, uncached)                      | remote binding → PlanetScale dev branch   | production branch, uncached                               |
| `ironcage-core`    | `DB_CACHED` (Hyperdrive)                         | remote binding → dev branch               | production branch, cached                                 |
| `ironcage-core`    | R2 buckets (blobs, backups, proposal quarantine) | remote bindings → dev buckets             | production buckets, bucket locks enabled                  |
| `ironcage-core`    | `KRAKEN_KEY` / `_SECRET`                         | unset; fixtures + remote validate harness | live key, withdrawal permissions absent, asserted at boot |
| `ironcage-core`    | `KRAKEN_EXPORT_KEY` / `_SECRET`                  | unset                                     | read-only key for tax exports, own nonce sequence         |
| `ironcage-core`    | `ALPACA_KEY` / `_SECRET`                         | paper-account keys                        | live keys, crypto disabled on the account                 |
| `ironcage-core`    | `AGENTS` service binding                         | local dev registry                        | `ironcage-agents`                                         |
| `ironcage-core`    | `COMPUTE` DO (`script_name`)                     | local, same dev command                   | `ironcage-compute`                                        |
| `ironcage-core`    | `DECISION_RECORDS` consumer                      | local queue                               | production queue                                          |
| `ironcage-core`    | `EMAIL_KEY`                                      | unset; the one interruption logs only     | live sending key                                          |
| `ironcage-agents`  | `CORE` service binding                           | local dev registry, read-only surface     | `ironcage-core`, read-only surface                        |
| `ironcage-agents`  | `AI_GATEWAY_TOKEN`                               | dev gateway, A$5/day cap (proposed)       | production gateway, per-capability caps                   |
| `ironcage-agents`  | `DECISION_RECORDS` producer                      | local queue                               | production queue                                          |
| `ironcage-compute` | container image                                  | local Docker daemon                       | deployed image, digest pinned                             |
| `ironcage-compute` | `DUMP_DSN` (read-only dump credential)           | unset                                     | dedicated read-only Postgres role, backup workflow only   |
| all                | Flagship kill switches                           | local flag values                         | production flags, own change log                          |

The venue key permissions themselves (which Kraken permissions are blocked, why Alpaca's crypto is disabled at the account level) are specified in [Venues](./06-venues.md). This chapter only places the secrets.

## 2. The monorepo

Packages are module boundaries first and build units second.

```
apps/
  app/        ironcage-app      (TanStack Start observatory)
  core/       ironcage-core     (engine Worker: actors, workflows, queue consumer)
  agents/     ironcage-agents   (Flue application)
  compute/    ironcage-compute  (backtest container)
packages/
  domain/     Effect Schemas and the ubiquitous language — sleeve, mandate, intent,
              fill, decision record, feed event. Imported by everything; imports nothing.
  engine/     strategy → cage → simulated fills, pure and deterministic.
              Imported by core (live and dry run) and compute (backtests).
  tax/        parcels, CGT, Division 775, FITO. Pure; imports domain only.
  contracts/  the HttpApi definitions (AppApi, AgentReadApi), queue message schemas,
              and generated clients. The only way Workers know each other.
  ui/         shared shadcn/ui-based components for the observatory.
```

Dependency direction is one-way and enforced by lint. `apps → contracts → domain`, and `apps → engine → domain`. Nothing in `packages/` may import from `apps/`, and `domain` imports nothing of ours.

`engine` and `tax` must stay free of Cloudflare APIs, I/O, clocks, and randomness. That purity is what lets one implementation serve live trading, dry run, and backtests.

## 3. Local development

Three processes, with service bindings resolved by the local dev registry.

```
apps/core:   wrangler dev -c wrangler.jsonc -c ../compute/wrangler.jsonc
apps/agents: vite dev
apps/app:    vite dev
```

Core and compute share one command because a cross-Worker Durable Object binding requires it. The other two attach independently, and `pnpm dev` at the root runs all three.

The database story splits by who is running the code. A human developer uses remote Hyperdrive bindings against a PlanetScale dev branch, so connection pooling and schema behavior under Hyperdrive are exercised on every run rather than discovered at deploy. CI uses a local Postgres container instead, so pipelines are hermetic, parallel-safe, and free of a shared mutable branch. The two setups run the same migration files and the same integration suites; the dev branch additionally exercises Hyperdrive, and CI additionally exercises a cold schema built from nothing.

The backtest container needs a local Docker daemon. Work that does not touch backtests may skip it.

## 4. Configuration and secrets

Secrets are Worker secrets set through wrangler, except the dump credential, which belongs to the backup workflow. They must not appear in code, in files, or in the database.

| Secret                          | Holder                               | Rotation             | Notes                                                                                    |
| ------------------------------- | ------------------------------------ | -------------------- | ---------------------------------------------------------------------------------------- |
| `KRAKEN_KEY` / `_SECRET`        | `ironcage-core`                      | quarterly (proposed) | withdrawal and withdrawal-address permissions absent, asserted at boot                   |
| `KRAKEN_EXPORT_KEY` / `_SECRET` | `ironcage-core`                      | quarterly (proposed) | read-only, used only by the tax-export workflow, own nonce sequence                      |
| `ALPACA_KEY` / `_SECRET`        | `ironcage-core`                      | quarterly (proposed) | the trading API does expose crypto-transfer endpoints; crypto is disabled on the account |
| `EMAIL_KEY`                     | `ironcage-core`                      | on compromise only   | sends the one interruption                                                               |
| `AI_GATEWAY_TOKEN`              | `ironcage-agents`                    | quarterly (proposed) | carries the per-capability spend caps                                                    |
| `DUMP_DSN`                      | backup workflow → `ironcage-compute` | quarterly (proposed) | dedicated read-only Postgres role, scoped to the nightly dump                            |
| `HEALTH_SIGNING_KEY`            | `ironcage-core`                      | on compromise only   | signs the health route's response                                                        |
| Postgres credentials (engine)   | Hyperdrive configs                   | PlanetScale-managed  | held by the Hyperdrive configuration, not by Workers                                     |
| Access signing keys             | Cloudflare                           | Cloudflare-managed   | the Worker verifies against public JWKS                                                  |

Three configuration rules bind everything else.

**Safety-relevant configuration is never a dashboard knob.** Mandates, system-cage limits, and every sleeve's mode and lifecycle live in Postgres behind ceremonies. Flagship holds only kill switches. Those switches are brake-only: they are checked in series before any action, an unreadable flag reads as "kill", and no flag can start, resume, or loosen anything. Turning a kill flag off does not resume trading; resumption always goes through the un-halt ceremony in Postgres. Everything else is code. No admin surface exists whose compromise loosens a limit.

**Model selection is the one warm configuration.** Provider, model, and inference parameters are versioned rows, read at dispatch and recorded on every decision record. Changing a model is a recorded act, so scorecards stay attributable.

**Dependency upgrades are acts.** Effect, Flue, and pinned platform packages move deliberately: read the changelog, upgrade, run every suite, then soak in dry run before the new version reaches a live sleeve.

## 5. Deployment

Preview URLs do not exist for Workers that implement Durable Object classes. Core hosts the actors, compute hosts the container control object, and the agents Worker hosts Flue-generated classes, so none of the three can be verified before it serves traffic. The app Worker has preview URLs disabled by the auth rule. The runbook therefore promotes first and verifies immediately after, with new entries blocked for the whole window. The protection pass is not affected by the block: fills, stops, ambiguity resolution, and reconciliation continue throughout, as they do under any pause ([The tick](./05-the-tick.md)).

**VERIFY:** this promote-then-verify flow has not been exercised. Prototype it on a scratch Worker with a Durable Object class, including a forced verification failure and rollback, before writing the final deploy script.

The runbook, in order. Steps 4 and 5 use callee-first ordering: core, then agents, then compute, then app.

1. **CI green.** Typecheck, lint, and every suite in section 6 except `venues/live` must pass on the exact commit. The migration step runs under a Postgres advisory lock, so two concurrent pipelines cannot interleave schema changes.
2. **Additive migration first.** Run it as its own step, before the code that needs it. New columns are nullable or defaulted. The migration records its checksum, tool version, start time, outcome, and a verification query.
3. **Block new entries.** A recorded operator act pauses new entries system-wide for the deploy window. Exits, stops, and reconciliation continue.
4. **Upload.** `wrangler versions upload` for each changed Worker, callee first. Nothing is serving yet.
5. **Promote and verify, per Worker.** `wrangler versions deploy`, callee first, keeping the prior version ID at hand. Immediately after each promotion, verify the live Worker: the signed health route returns the new version ID under a valid signature; one read path returns data; the vitals query returns rows; one `AppApi` response decodes against its schema; the Durable Object class list is unchanged; for agents, no configured provider resolves to a vendor-direct URL; for the app, Overview loads, the socket reaches `Ready`, and the shell renders mode. A failed check triggers rollback of that Worker before the pipeline proceeds.
6. **Lift the entry block.** Another recorded act. The block's duration is part of the deploy's feed record.
7. **Confirm the feed events.** Each deploy writes a `System` event carrying the Worker name and version ID. A missing event is itself a defect.
8. **Destructive migrations last.** A drop or a narrowing ships no earlier than **7 days** (proposed) after the deploy that stopped reading, as its own deploy.

**Rollback is one command**: `wrangler versions deploy <previous-version-id>@100%`. The target is a return to the prior version within **2 minutes** (proposed) of the decision. Rollback creates a new deployment of old code; it does not roll back Postgres, R2, Durable Object state, or anything a venue has already accepted. Data correction after a rollback is a new migration or a domain correction, never an edit to an applied migration.

Two guards keep rollback real rather than nominal.

- **Every migration is tested upgrade → rollback → upgrade.** CI applies the migration, runs the previous release's suite against the expanded schema, then runs the new suite. A migration that breaks old code is not additive and does not ship as one.
- **A Durable Object class migration blocks rollback.** A deploy that adds, removes, or renames a Durable Object class, or removes a binding, can make the prior version unsafe to run. The deploy script detects this from the wrangler configuration diff, records "rollback unsafe" on the deploy's feed event, and refuses the one-command rollback for that deploy. Recovery from such a deploy is roll-forward.

For the rare change that cannot be expressed additively, the sequence is expand, migrate, contract:

1. Add the new columns, tables, or indexes alongside the old.
2. Deploy code that writes both representations where necessary.
3. Backfill in bounded, resumable batches with a durable cursor.
4. Verify counts, checksums, and read equivalence between the representations.
5. Switch reads to the new representation.
6. Stop the old writes.
7. Remove the obsolete structures in a later release, after the 7-day window and a verified backup.

**Deploying with positions open is safe by design.** Durable Objects restart on deploy, and in-flight markers, query-then-post execution, at-least-once alarms, and startup reconciliation already cover that restart. Anything a deploy could break mid-flight, a platform restart could have broken anyway. The entry block exists not because a deploy is dangerous but because verification happens on the live version, and a version that fails verification should not have opened new positions in the meantime.

## 6. Testing

Named suites, each asserting one property. The suite name is the directory it lives in.

| Suite                   | Package              | Asserts                                                                                                                                                                                                                                                                                              | Runs       |
| ----------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `engine/cage.property`  | `packages/engine`    | `effective ≤ desired` under arbitrary capability outputs; entry checks reject on unknowns; thresholds trip at exactly `>` and `<`                                                                                                                                                                    | every push |
| `engine/fills.property` | `packages/engine`    | simulated fills never exceed the requested quantity; fees are non-negative; no fill exists without an order                                                                                                                                                                                          | every push |
| `engine/determinism`    | `packages/engine`    | the same backtest manifest run twice produces a byte-identical result hash                                                                                                                                                                                                                           | every push |
| `tax/parcels.property`  | `packages/tax`       | parcel selection never consumes more than remains; disposals reconcile to acquisitions                                                                                                                                                                                                               | every push |
| `tax/golden`            | `packages/tax`       | hand-verified scenarios, and one comparison against the prior service's oracle export                                                                                                                                                                                                                | every push |
| `money/dedupe.property` | `apps/core`          | re-import is idempotent under arbitrary chunking and overlap of the same file                                                                                                                                                                                                                        | every push |
| `contracts/roundtrip`   | `packages/contracts` | every Schema satisfies `decode ∘ encode = identity`; the agents' wire schemas accept exactly what the authoritative schemas accept                                                                                                                                                                   | every push |
| `core/actors`           | `apps/core`          | under workerd: duplicate alarms are idempotent; a tick arriving mid-flight no-ops; an overdue reservation with an intent row flags `reconciliation_required` and only an orphan reservation auto-releases; the `pending_effects` drainer retries across restart; duplicate queue run IDs are dropped | every push |
| `core/recovery`         | `apps/core`          | against the CI Postgres container: the recovery scan resolves a marker-without-row and a row-without-outcome after a simulated crash between marker and commit                                                                                                                                       | every push |
| `venues/fixtures`       | `apps/core`          | decoded fixtures of real responses, including partial fills, synthetic-pair fills, and timeout-then-found                                                                                                                                                                                            | every push |
| `venues/live`           | `apps/core`          | Alpaca's paper environment end to end; Kraken order-shape checks through the remote validate harness (the order-capable key never leaves it)                                                                                                                                                         | nightly    |
| `app/budget`            | `apps/app`           | Overview paints vitals and the attention count inside the chapter's budget                                                                                                                                                                                                                           | every push |

**The standing soak is dry run itself.** A change that passes CI reaches a live sleeve only after the affected paths have run in production dry run for **7 days or 50 ticks, whichever is longer** (proposed). Both numbers matter: a slow sleeve needs the tick count, and a fast sleeve needs the calendar time.

## 7. Observability

Vitals are computed from Postgres rows, so a dead engine shows as a dead engine rather than a stale green light. A cron recomputes them every **60 seconds** (proposed) and writes a row, so every vital carries an as-of time and derives from the record. A vitals row older than **180 seconds** (proposed) renders the whole panel as unknown, not as its last healthy reading.

All thresholds below are proposed.

| Vital              | Computation                                                       | Degraded                                       | Failing                                             |
| ------------------ | ----------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------- |
| Engine             | per active sleeve, `now − due(next tick)` over its cadence        | overdue by > 25% of the interval               | overdue by > 100% of the interval                   |
| Market data        | per venue, age of the newest closed candle over its timeframe     | > 25% past the next close                      | > 100% past, or any sleeve stood down for a gap     |
| Venue connectivity | per venue actor, time since the last successful private call      | > 5 min, or 1 failure in 3 attempts            | 3 consecutive failures, or > 15 min                 |
| AI runs            | per capability, status and age of the last scheduled run          | one failed run, or overdue by > 25% of cadence | 2 consecutive failed runs, or overdue by > 100%     |
| Decision queue     | `decision-records` depth and oldest message age                   | > 50 messages or oldest > 5 min                | > 500 messages or oldest > 30 min                   |
| Outbox lag         | age of the oldest undelivered `pending_effects` row               | > 60 s                                         | > 300 s                                             |
| Reconciliation     | per live sleeve, age of the last successful reconcile             | > 1.5 × its schedule                           | any open mismatch                                   |
| Database           | p95 `AppApi` query latency over the trailing 5 min                | > 250 ms                                       | > 1000 ms, or a connection error in the last minute |
| Backups            | age of the last successful dump; time since the last restore test | dump older than 26 h                           | dump older than 50 h, or last restore test failed   |

**The cron watchdog re-arms dead alarms.** Every tick-owning actor maintains a `next_due_at` row in Postgres. Every **5 minutes** (proposed) a cron compares those rows to the clock. When an actor is past due with no armed alarm, the watchdog re-arms it and writes a feed event recording that it did so. This matters because Durable Object alarm handlers receive at most six automatic retries; a persistently failing handler can end with no alarm armed at all, and only an outside observer can notice.

**An external dead-man monitor covers "core itself is down."** Vitals, the feed, and the halt-email outbox all live inside core, so none of them can report core's own death. A free external uptime service polls the signed health route every **5 minutes** (proposed). The route returns the version ID, the current time, and an HMAC signature under `HEALTH_SIGNING_KEY`, so a cached or spoofed 200 does not count as alive. Two consecutive failures (proposed) alert the operator through the uptime service's own channel, which shares nothing with our email path.

**Telemetry is stamped with our IDs.** Tick timings, venue latencies, and Workflow progress go to Workers observability with the intent, tick, and run IDs (UUIDv7) on their spans. Deep AI observability lives in AI Gateway. Both are debugging layers; neither is the record, and nothing reads them to make a decision.

**Costs are pulled on schedule.** AI spend per capability comes from AI Gateway daily at **01:00 UTC** (proposed). Infrastructure spend comes from Cloudflare's billable-usage API daily at **01:15 UTC** (proposed). Venue fees come from the blotter continuously, because every fill row carries its fee and fee asset.

**Alerting is the product's own attention system.** Degraded vitals surface on Overview. Critical events persist until acknowledged. A system halt sends the one contentless email through the outbox. No separate pager stack exists; the one thing the attention system cannot report, its own death, is the dead-man monitor's job.

## 8. Backups and recovery

Two independent copies of the record, with different failure modes.

**PlanetScale continuous backups and point-in-time recovery are the first line.** They cover recovery to a chosen minute, and they depend entirely on one vendor relationship.

**A nightly logical dump is the second.** A scheduled workflow triggers the dump at **03:00 UTC** (proposed), and the dump itself executes in the compute container, because Workers cannot run `pg_dump`. The container connects with `DUMP_DSN`, a dedicated read-only Postgres role scoped to the backup workflow. The engine's own credentials stay inside the Hyperdrive configurations, and the compute boundary never holds a writable database credential. The dump lands in R2 under `backups/{yyyy-mm-dd}/`. The independent copy's recovery point objective is **24 hours** (proposed); point-in-time recovery covers the gap between dumps.

**R2 protection is bucket locks.** The backup and evidence buckets carry bucket locks, and keys are content-addressed and immutable once written, so neither a tooling accident nor a compromised credential can silently rewrite history. R2 has no native object versioning; nothing here assumes it.

**A restore test runs quarterly** (proposed). It restores the most recent dump into a PlanetScale dev branch and works through a verification checklist:

- row counts per table match the source, and a checksum over the blotter tables matches;
- the ledger identity holds: system equity equals unallocated cash plus the sum of sleeve equities plus in-transit amounts ([Domain](./02-domain.md));
- positions recomputed from fills match the positions view;
- a tax recompute over the restored record matches the last accepted run.

The result is a feed event either way, so a silently broken backup becomes a visible failure.

**Restoring for real follows one order**, because a restored Postgres is older than every Durable Object's projection of it, and possibly older than what a venue has already accepted:

1. **Halt everything.** The shell control, or the Flagship kill flag if core itself is the problem.
2. **Restore Postgres** to the chosen point in time.
3. **Rebuild every actor projection.** `rebuild()` on sleeves, venues, and the system cage, so no projection is ahead of the record.
4. **Reconcile every venue.** The venue's state may include real activity from after the restore point. Anything the restored record does not explain surfaces as claim items for the operator ([Venues](./06-venues.md)).
5. **Quarantine pre-restore obligations.** Every pending intent and every undelivered `pending_effects` row from before the restore point is marked quarantined, never re-driven. A venue may have accepted the order the restored database has forgotten sending; replaying it would double-order. Quarantined items resolve through reconciliation, not through the drainer.
6. **Un-halt through the ceremony**, from the incident report the halt generated, only after reconciliation is green.

**Retention: nothing is deleted.** The entire record for years fits in single-digit gigabytes. Two mechanism tables are the named exceptions, prunable by policy because they carry no history: the queue dedupe table, and `pending_effects` rows that have been delivered.

## 9. Incidents

The system's incident flow is the product's flow. Something breaches, the sleeve or the system halts, an incident report is generated, the one interruption sends, and the operator un-halts through the ceremony from that report.

There are therefore no runbooks to memorize for trading incidents. The runbook is rendered, each time, by the thing that halted.

The genuinely operational runbooks are a short list, living beside this file as they are written:

- Venue key rotation, including compromise.
- Restoring from the R2 dump (the six-step order above, with concrete commands).
- Rotating the AI Gateway token and re-registering providers.
- W-8BEN renewal.
- Recovering a Durable Object by `rebuild()` after suspected corruption.
- Access lockout recovery, for the day the identity provider locks the operator out.

## 10. Platform assumptions

This specification depends on externally sourced facts about Cloudflare, PlanetScale, and the venues. Platform behavior changes, and confidence is not evidence, so every such fact lives in this register with its primary source and the date it was last reviewed. The register has already caught three errors in earlier drafts of this specification: R2 was assumed to have object versioning (it does not), Alpaca was assumed to have no transfer surface (its trading API has one), and core was assumed to get preview URLs (Durable Object Workers do not). Keeping this table current is an operational duty, on a **quarterly** (proposed) review cadence. Venue-specific facts live in their own register in [Venues](./06-venues.md).

All rows below were reviewed on 2026-08-08.

| Fact                                                                                                                                                                                                             | Source                                                                                                                                                                                 | Local validation                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Durable Object storage is transactional and strongly consistent; one alarm per object; alarm handlers are at-least-once with at most six automatic retries; external effects sit outside the local transaction   | [Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), [SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)                   | crash tests at the DO/Postgres boundary; the watchdog covers exhausted alarm retries       |
| Queues deliver at-least-once with no ordering guarantee                                                                                                                                                          | [Delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)                                                                                         | consumer dedupe-in-transaction suite                                                       |
| Workflows: step retries, sleeps, and event waits up to 365 days; 1 MiB limit on non-streaming step results; completed-instance retention is plan-dependent                                                       | [Workflow limits](https://developers.cloudflare.com/workflows/reference/limits/)                                                                                                       | backup and restore-test workflow configuration                                             |
| Service bindings support private HTTP or RPC; Smart Placement applies to fetch handlers and ignores RPC                                                                                                          | [Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/), [Placement](https://developers.cloudflare.com/workers/configuration/placement/) | we use HTTP only; latency through chained bindings measured before reliance                |
| Containers are generally available, use ephemeral local disk, and are managed through a Worker/Durable Object control plane                                                                                      | [Architecture](https://developers.cloudflare.com/containers/platform-details/architecture/)                                                                                            | startup, shutdown, duration, cost, and the R2 data path measured in the backfill prototype |
| R2 object operations are strongly consistent; bucket locks and immutable keys protect evidence; no native object versioning exists                                                                               | [Consistency](https://developers.cloudflare.com/r2/reference/consistency/), [Bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)                                 | bucket-lock configuration asserted by the deploy checks                                    |
| Hyperdrive may cache eligible reads; writes do not invalidate cached reads; separate cached and uncached configurations are supported                                                                            | [Query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/)                                                                                                  | pooling and transaction behavior with Effect SQL exercised on every human dev run          |
| Access hands the origin a signed assertion to validate for issuer, audience, signature, and expiry                                                                                                               | [JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)                                        | assertion behavior on WebSocket upgrades tested before reliance                            |
| Worker versions can be uploaded and deployed separately; rollback creates a new deployment of a prior version and rolls back no external state; Workers implementing Durable Objects do not receive preview URLs | [Versions](https://developers.cloudflare.com/workers/versions-and-deployments/), [Preview URLs](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)      | the promote-then-verify prototype (section 5, **VERIFY**)                                  |
| AI Gateway provides logging, cost tracking, and spend rules; spend enforcement is not an exact deterministic budget boundary                                                                                     | [Spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/), [Logging](https://developers.cloudflare.com/ai-gateway/observability/logging/)                    | per-capability caps observed against real spend before live sleeves                        |
| Flagship is public beta; flag changes may take up to 30 seconds to propagate                                                                                                                                     | [Flagship](https://developers.cloudflare.com/flagship/)                                                                                                                                | unreadable-flag-reads-as-kill behavior tested under forced evaluation failure              |
| Flue 1.0 is beta, with generated Cloudflare deployment classes and migration caveats                                                                                                                             | [Flue 1.0 beta](https://flueframework.com/blog/flue-1-0-beta/), [Cloudflare deployment](https://flueframework.com/docs/ecosystem/deploy/cloudflare/)                                   | generated-class migration and rollback exercised in the deploy prototype                   |
| PlanetScale supports Postgres 17 and 18; production branches provide replicas, failover, backups, and point-in-time recovery                                                                                     | [Compatibility](https://planetscale.com/docs/postgres/postgres-compatibility), [Backups](https://planetscale.com/docs/postgres/backups)                                                | the restore test; unknown-commit recovery after forced connection loss                     |

Two products are explicitly not dependencies: Cloudflare Artifacts is closed beta and Cloudflare Computer is preview-only. Neither appears in v1.

The Postgres major version is chosen only after Hyperdrive and the Effect driver pass the development compatibility suite against it; nothing hard-codes 18 before that proof. PlanetScale failover is not assumed to take one or two seconds; on connection loss with an unknown commit outcome, the outcome is queried by idempotency key before any retry.

## Values set in this chapter

Every number above, its owner, and its status. "Proposed" means: pick differently and only configuration changes.

| Value                          | Default                                                    | Owner            | Status   |
| ------------------------------ | ---------------------------------------------------------- | ---------------- | -------- |
| Environments                   | local + production only                                    | operations       | decided  |
| CI database                    | local Postgres container                                   | operations       | decided  |
| Human dev database             | PlanetScale dev branch via remote bindings                 | operations       | decided  |
| Local AI Gateway spend cap     | A$5/day                                                    | gateway config   | proposed |
| Entry block during deploy      | whole promote-and-verify window                            | operations       | decided  |
| Destructive migration delay    | 7 days after the read stops                                | operations       | proposed |
| Rollback target                | prior version within 2 min                                 | operations       | proposed |
| Dry-run soak before live       | 7 days or 50 ticks, longer of                              | operations       | proposed |
| Secret rotation cadence        | quarterly                                                  | operator         | proposed |
| Vitals recompute cron          | every 60 s                                                 | core cron        | proposed |
| Vitals panel unknown threshold | row older than 180 s                                       | core             | proposed |
| Engine vital thresholds        | > 25% / > 100% overdue                                     | core             | proposed |
| Venue vital thresholds         | > 5 min / 3 failures or 15 min                             | core             | proposed |
| Decision queue thresholds      | 50 msgs or 5 min / 500 or 30 min                           | core             | proposed |
| Outbox lag thresholds          | 60 s / 300 s                                               | core             | proposed |
| Database latency thresholds    | p95 250 ms / 1000 ms                                       | core             | proposed |
| Backup vital thresholds        | dump > 26 h / > 50 h or failed restore test                | core             | proposed |
| Watchdog cadence               | every 5 min, off Postgres `next_due_at`                    | core cron        | proposed |
| Dead-man poll interval         | every 5 min, alert on 2 consecutive failures               | external monitor | proposed |
| Cost pulls                     | 01:00 and 01:15 UTC daily                                  | core cron        | proposed |
| Nightly logical dump           | 03:00 UTC, in the compute container                        | backup workflow  | proposed |
| Independent-copy RPO           | 24 h                                                       | operations       | proposed |
| Restore test cadence           | quarterly                                                  | operations       | proposed |
| Register review cadence        | quarterly                                                  | operator         | proposed |
| Retention                      | nothing deleted; prunable: queue dedupe, delivered effects | data policy      | decided  |

## Alternatives considered

- **A staging environment.** Rejected: it would double the operational surface for one operator, and it tests strategies worse than dry run and code worse than a rollback-capable version.
- **Preview-URL verification for core.** Rejected because it is impossible: Workers implementing Durable Object classes do not receive preview URLs. Promote-then-verify behind an entry block is the design that remains, and it is the reason the entry block exists.
- **`wrangler deploy` straight to production.** Rejected: uploading a version first is what keeps the prior version ID at hand and makes the two-minute rollback possible at no extra cost.
- **A separate alerting stack.** Rejected: a second definition of "something is wrong" drifts from the product's, and the product already interrupts the operator exactly once. The external dead-man monitor is not an alerting stack; it answers one question the product cannot answer about itself.
- **One database setup for humans and CI.** Rejected in both directions: a shared dev branch makes CI runs interfere with each other and with a human's session, and a local-only container would leave Hyperdrive behavior untested until deploy. Humans get the branch, CI gets the container.
- **Running `pg_dump` from a Worker or Workflow directly.** Rejected because Workers cannot run `pg_dump`. The workflow schedules; the compute container executes.
- **Reusing the engine's database credential for dumps.** Rejected: the compute boundary would then hold a writable credential to the record. The dump runs under a dedicated read-only role that can do nothing but read.
- **R2 object versioning as the backup guard.** Rejected because the feature does not exist. Bucket locks plus content-addressed immutable keys provide the guarantee versioning was assumed to provide.
- **Backups to a second cloud provider.** Rejected for now: R2 with bucket locks plus PlanetScale's own backups are two independent copies already, and a third vendor adds a credential to hold.

## Open questions

1. **The promote-then-verify prototype.** The exact verification route for a Durable Object Worker is unproven. Safe fallback: the entry block stays until every check passes manually. Must close before: the first production deploy of core. Evidence: a prototyped deploy on a scratch Worker with a DO class, including a forced verification failure and a rollback.
2. **The Kraken remote validate harness.** Whether `validate: true` truly has no permission scope below order-capable is taken from the current docs. Safe fallback: fixtures only, no local validate calls. Must close before: venue integration. Evidence: the exact wording of Kraken's API permission documentation, or a support confirmation.
3. **Soak numbers.** 7 days or 50 ticks is a first guess. Safe fallback: the longer figure wherever in doubt. Must close before: the first live sleeve. Evidence: how many distinct code paths a sleeve's cadence exercises per day, measured in dry run.
4. **Dev-branch data.** Whether the PlanetScale dev branch carries a redacted copy of production or synthetic fixtures is unsettled; the restore test currently assumes it can be overwritten. Safe fallback: synthetic fixtures. Must close before: the first restore test against real data. Evidence: a decision on what production data may leave the production branch.
5. **Restore test cadence.** Quarterly is chosen for effort, not for evidence. Safe fallback: quarterly. Must close before: live capital. Evidence: if the test is fully automated, monthly costs nothing and the cadence should tighten.

## Build checklist

- [ ] `wrangler.jsonc` per Worker with the binding matrix above, and the boot assertion that refuses trade-capable venue keys under `ENVIRONMENT=local`
- [ ] Root `pnpm dev` running the three processes, with remote bindings for Hyperdrive and R2
- [ ] Lint rule enforcing the one-way dependency direction, including the no-Cloudflare rule in `engine` and `tax`
- [ ] CI pipeline: every suite in section 6, the local Postgres container, the advisory-lock migration step, the upgrade → rollback → upgrade migration test, and `venues/live` nightly
- [ ] The remote Kraken validate harness, holding the order-capable key it never releases
- [ ] Deploy script implementing the eight-step runbook: entry block, callee-first promotion, post-promotion verification, the DO-class rollback guard, and the feed event per Worker
- [ ] The signed health route with `HEALTH_SIGNING_KEY`, serving both deploy verification and the dead-man monitor
- [ ] Vitals cron, the vitals row, and the thresholds table as one tested pure function
- [ ] Watchdog cron reading `next_due_at`, re-arming dead alarms, and recording each re-arm as a feed event
- [ ] External dead-man monitor configured against the health route, alerting through its own channel
- [ ] Cost-pull crons for AI Gateway and Cloudflare billable usage
- [ ] Backup workflow: container-executed `pg_dump` under the read-only `DUMP_DSN`, writing to `backups/{yyyy-mm-dd}/` in a bucket-locked R2 bucket
- [ ] Restore-test workflow: dev-branch restore, the four-item verification checklist, feed event on both outcomes
- [ ] The restore runbook with the pre-restore quarantine step, written and rehearsed
- [ ] The platform-assumption register kept in this file with sources and review dates, reviewed on schedule
- [ ] The six operational runbooks written and committed beside this file
