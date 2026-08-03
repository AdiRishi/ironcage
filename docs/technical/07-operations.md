# Operations

How the system is run: environments, configuration, deploys, observability, backups, and the runbooks for the bad days. The operating principle is the same as the trading principle: boring, recorded, fail-closed.

## Environments

Two, not three:

- **Production** — the Cloudflare account + the gateway VPS. Dry-run and live are _data-level modes within production_ (a sleeve's state, a mandate's flag), sharing infrastructure deliberately: dry run only proves anything if it runs on the real pipes.
- **Local dev** — `wrangler dev` (Miniflare) with local D1/R2 emulation, the fill simulator as the execution edge, and recorded fixtures for venue/AI responses. `pnpm dev` runs the whole constellation locally; no cloud resources required for feature work.

No staging. The rehearsal space for behavior is dry-run mode; the rehearsal space for code is local dev plus the test suite.

## Configuration & secrets

- Mandates, grant registry, cage config: **code**, versioned, reviewed — never dashboard-edited.
- Worker secrets (`wrangler secret`): AI provider keys (grants/jobs workers only), the gateway shared-secret. The web app and engine hold no AI keys; nothing on Cloudflare holds venue keys.
- Venue keys exist in exactly one place: the gateway VPS environment file (root-only, never in git). Key custody ritual per venue in the runbook: trade-only permissions, withdrawals disabled, IP-locked where supported (Kraken), rotation on any suspicion and on a fixed calendar.
- Tunnel credentials: the VPS's cloudflared config, same custody rules.

## Deploys

- Cloudflare apps: `turbo deploy` → `wrangler deploy` per app; D1 schema changes via wrangler migrations, additive-only by convention (append-only tables make destructive migrations pointless anyway). Wrangler's versioned deploys give one-command rollback.
- Gateway: `pnpm deploy:gateway` — rsync + systemd restart over SSH. The gateway is deliberately boring enough that this is safe; it holds no state but its journal.
- Order of operations for breaking contract changes: contracts → consumers → producers, in separate deploys; `@app/contracts` versioning makes drift a type error at build time.
- Every deploy emits a feed event (`system` category) with the git hash — deploys are part of the audit trail, because "what code was live when this traded?" must always be answerable. The engine records the code version into every tick's telemetry.

## Observability

- **The activity feed is the primary signal** — by product design, anything that matters is an event. Ops-grade telemetry sits beneath it: Workers Logs + structured logging (one JSON line per tick/step with sleeve, tick id, duration, outcome), Workflow run states for pipelines, `engine_telemetry` for cadence health, AI Gateway analytics for spend.
- The Overview vitals are computed from these (tick age, data freshness, gateway `/health`, AI run status) — the ops dashboard and the product dashboard are the same thing, on purpose.
- Error budget: any unhandled error in engine/grants/jobs code paths lands as a `warning`/`critical` feed event via the top-level Effect error channel — silent failure is treated as a defect class, tested for explicitly.

## Backups & recovery

- D1 Time Travel (30-day point-in-time restore) is the first line.
- `apps/jobs` exports the irreplaceable tables (orders, intents, capital_events, events, mandate_versions, transactions) to R2 as dated JSONL, daily; R2 object versioning on. Everything else is derived or re-collectable.
- Recovery drill (run once before live capital, then annually): restore the export into a fresh D1, run the blotter recompute, diff equity against snapshots. Recovery that hasn't been rehearsed is a rumor.
- The gateway journal (its local call log) syncs to R2 daily — the second side of every venue conversation survives the VPS.

## Cost envelope

Workers Paid ~US$5/mo · VPS ~US$5/mo · AI spend per grant budgets (expected US$3–10/mo at v1 cadences, visible per-grant in the ledgers) · D1/R2/Workflows within included allowances at this scale · Cloudflare Access free tier. Total ≈ **US$15–20/month**; any line item drifting is visible in the monthly portfolio review's cost section.

## Runbooks (kept as short checklists beside this doc as they're written)

- **Gateway down**: sleeves fail closed automatically; check Tunnel + systemd; venue-side stops noted as still armed; incident report auto-generated if positions were open.
- **Reconciliation mismatch**: sleeve is already halted; read the incident report's two-sided diff; adopt-or-correct; un-halt from the report.
- **Kill switch fired**: system halted, winddowns ran; the incident report is the checklist — review state, decide per sleeve, restart is manual and recorded.
- **Suspected key compromise**: rotate at venue (keys are trade-only, withdrawals disabled — blast radius is bad trades, which the cage bounds); halt-all while rotating; review gateway journal.
- **VPS loss**: provision fresh VPS from the setup script, restore tunnel + env from the credentials store, re-lock Kraken keys to the new IP; system was failing closed throughout.

## Testing strategy

`packages/core` is the invariant vault — property-style tests on the cage (never approves above caps; fail-closed on any missing input; attenuators can never increase size), the blotter (recompute equals expectation across partial fills, fees, reversals; order-independence), the simulator (golden tests against recorded book fixtures), and the stats module (multiplicity corrections). Contract round-trip tests pin every schema. Workflow pipelines get step-level tests with injected failures (gateway timeout mid-place, crash between fill and blotter write) asserting idempotent recovery. The feed-totality rule — every state change emits exactly one event — has its own test harness walking write paths. And dry run remains the continuous integration test of the whole: divergence from backtest expectation is a defect until proven a market condition.
