# Operations

Running Ironcage: environments, configuration and secrets, deployment, testing, observability of the system itself, and backups. The through-line: the operator's time is the scarcest resource, so operations are boring, recorded, and reversible.

## Environments

Two, deliberately:

- **Local development** — the three dev processes ([Topology](./02-topology.md)), a PlanetScale dev branch, Alpaca's paper environment and Kraken's validate-only order flag for venue-touching work, and dry-run mode for everything else. Local never holds live venue keys.
- **Production** — the operator's personal Cloudflare account ([D20](./00-decisions.md#d20)). There is no staging tier: **dry run is the staging environment for strategies, and versioned deploys with instant rollback are the staging substitute for code** ([D15](./00-decisions.md#d15)). A second full environment would double operational surface for one operator and test nothing that dry run doesn't test better.

## Configuration and secrets

- **Venue API keys, gateway keys, and signing secrets** are Worker secrets on `ironcage-core` (venues) and `ironcage-agents` (AI Gateway) — set via wrangler, never in code, files, or the database. The Kraken key's no-withdrawal property is asserted at boot ([D22](./00-decisions.md#d22)).
- **Safety-relevant configuration is never a dashboard knob**: mandates and system-cage limits live in Postgres behind ceremonies; kill switches live in Flagship with its own change log; everything else is code. There is no admin surface whose compromise loosens anything.
- **Model selection** is the one warm configuration: versioned rows, changed by a recorded act ([D11](./00-decisions.md#d11)).

## Deployment

- **Mechanics** ([D15](./00-decisions.md#d15)): `wrangler versions upload` → verify against the preview → `versions deploy`, with instant rollback among recent versions. Deploy order on interface changes: callee before caller (core before app/agents).
- **Every production deploy is a feed event** carrying the Worker and code version — the product's System taxonomy requires it, and it turns "what changed before this incident?" into a query.
- **Deploying while positions are open is safe by design, not by care**: Durable Objects restart on deploy, which is precisely the crash the engine already survives — in-flight markers, query-then-post, at-least-once alarms, and startup reconciliation ([Engine](./04-engine.md)). A deploy is an ordinary restart, and anything a deploy can break mid-flight, a platform restart could have broken anyway.
- **Migrations** run before the code that needs them, additive-first ([Data](./03-data.md)); destructive steps are their own later deploy.
- **Dependency upgrades are acts**: Effect, Flue, and pinned platform packages move deliberately — read the changelog, upgrade, run the full test suite and a dry-run soak before the new version touches live sleeves.

## Testing

What must be true, and where it's proven:

- **`packages/engine` and `packages/tax` are pure — they get the heavy artillery.** Property-based tests for the cage (the reduce-only identity `effective ≤ desired` under arbitrary capability outputs; fail-closed under arbitrary missing inputs; monitors trip at exactly their thresholds), the fill model, parcel selection, and dedupe (re-import idempotency under arbitrary chunking/overlap). Golden-file tests for tax against hand-verified scenarios and, once, against the prior service's oracle export.
- **Determinism is a test**: the same backtest manifest run twice must produce byte-identical results; this runs in CI and _is_ the same check gate 2 of the pipeline performs in production ([Workbench](./07-workbench.md)).
- **Actors and Workflows** run under the platform's local runtime (the same workerd the Vite plugin uses): tick idempotency under duplicate alarms, interleaving discipline (a tick arriving mid-flight), reservation expiry, outbox retry, queue-consumer dedupe.
- **Venue adapters** test three ways: decoded fixtures of real API responses (including the ugly ones — partial fills, synthetic-pair fills, timeout-then-found), Alpaca's paper environment for live-wire integration (including the documented doc-contradictions around fractional orders, verified there before reliance), and Kraken's `validate: true` for order-shape checks without execution.
- **Schemas round-trip**: every Schema in `packages/domain`/`contracts` has an encode-decode property test; the wire seam to Flue additionally checks that the agents' wire schemas accept exactly what the authoritative schemas accept.
- **The standing soak**: dry run itself. A change that passes CI still reaches live sleeves only after the affected paths have run in dry-run/production for a sensible interval — the lifecycle discipline applied to our own code.

## Observability of the system itself

- **Vitals are computed, stored, and served by core** ([Overview product spec](../product/01-overview.md)): engine tick age per cadence, market-data freshness per venue, venue/gateway reachability, last AI run status. Each is a small query over recorded rows plus a liveness probe — vitals are derived from the record, so a dead engine shows as a dead engine, not as a stale green light. The cron watchdog is the independent observer that re-arms dead alarms and reports having done so.
- **Engine telemetry** (tick timings, venue latencies, Workflow progress) flows to Workers observability with our ULIDs stamped on spans ([D12](./00-decisions.md#d12)); deep AI observability lives in AI Gateway. Both are debugging layers; neither is the record.
- **Costs**: AI spend per capability from AI Gateway, infrastructure spend from Cloudflare's billable-usage API, venue fees from the blotter — pulled on schedule into the rows Portfolio's cost display reads.
- **Alerting is the product's own attention system**: vitals degrade → Overview; criticals → acknowledgment; halts → the one interruption by email ([D19](./00-decisions.md#d19)) via the outbox. No separate pager stack exists to drift out of sync.

## Backups

PlanetScale's continuous backups and point-in-time recovery are the first line. Independently, a scheduled Workflow dumps logical exports of Postgres to R2 (recorded acts, verified restorable by a periodic restore-to-dev-branch test), because the record's durability should not depend on a single vendor relationship. R2 artifacts are immutable by convention; the bucket carries object versioning as a guard against tooling accidents. Retention everywhere: forever ([Data](./03-data.md)).

## Incident shape

The system's own incident flow is the product's: something breaches → automatic halt → incident report generated → the one interruption → the operator un-halts through the ceremony from the report. Operationally that means there are no runbooks to memorize for trading incidents — the runbook is rendered, each time, by the thing that halted. The short list of genuinely operational runbooks (venue key rotation, W-8BEN renewal, restoring from backup, rotating the session secret) lives in the repo beside this file as they're written.
