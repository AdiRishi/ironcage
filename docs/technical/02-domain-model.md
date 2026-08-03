# Domain model & persistence

Every boundary in the system speaks `effect/Schema` types defined in `@app/contracts`; every durable fact lives in exactly one home. Monetary and quantity values travel as decimal strings and compute as `BigDecimal` — a float touching money is a bug by definition.

## The contracts package

Grouped by subpath export, schema-only (no runtime logic beyond constants):

- **`/mandate`** — `Mandate` (the full document: identity, market/venue/instruments, strategy id + parameters, cadence, grants held with per-sleeve parameters, capital cap, risk limits, winddown policy, benchmarks) and `MandateVersion` (immutable, hash-identified, with author, reasoning, and — for AI-proposed versions — the gate record).
- **`/grants`** — `GrantRegistryEntry` (id, valve class, cadence, staleness window, output schema reference, safe default, control definition, default demotion rule — mandates may tighten it) plus each grant's output schema: `RegimeVector` (per-instrument axes on the quantized ladder, rationale, sources, generatedAt), `EventVeto` (lock request with reason, source snapshot, expiry), `RiskTightening` (named limit, temporary value ≤ mandate value, expiry), `Proposal` (corridor move or strategy variant, with rationale and backtest reference), `TradeProposal` (instrument, side, size, rationale, prompt-trace reference — the Piloted class's output, consumed only by the engine under the mandate's daily budget).
- **`/trading`** — `OrderIntent` (client order id, sleeve, instrument, side, type, amounts as decimal strings, the strategy tag and attenuation record it was born under, cage verdict), `Order` (intended vs. venue-reported fields kept separate), `Verdict` (Approved with clamped size | Rejected with every violated rule), `PairLock`.
- **`/capital`** — `CapitalEvent` (deposit | withdrawal | fund | reduce | return, with amounts, venue, note, evidence reference), `SystemCageConfig`.
- **`/events`** — the activity-feed event union: category, severity, origin, summary, payload, links (mirrors `docs/product/03-activity.md` exactly — the taxonomy there is the schema here).
- **`/market`** — `Candle`, `InstrumentRef` (venue + symbol + precision/lot rules frozen at first use), `OrderBookSnapshot` (for the fill simulator).
- **`/money`** — `Transaction` (imported bank rows), `CategoryRule`, `Account`.

## D1 (relational, hot)

One database. Append-only tables are enforced by convention and by the absence of UPDATE paths in code; derived tables are rebuildable.

| Table | Nature | Notes |
| --- | --- | --- |
| `mandates`, `mandate_versions` | append-only | current pointer per sleeve; versions immutable |
| `sleeves` | state row | state machine field, allocation, halt reason |
| `orders` | append-only + status | the blotter's spine; venue-reported fields updated only by fill sync/reconciliation |
| `intents` | append-only | every intent incl. rejections, with full verdict JSON |
| `trades` | derived | recomputed from `orders` (`recalcTradeFromOrders`); rebuildable |
| `pair_locks` | append-only + expiry | source: protection, grant, operator |
| `grant_outputs` | append-only | every validated grant tick output; staleness computed on read |
| `grant_ledger` | derived, periodic | per-grant value-added vs. control (accrued by `apps/jobs`) |
| `control_decisions` | append-only | the counterfactual leg: what the no-AI path would have done, with simulated fills |
| `proposals`, `gate_runs` | append-only + status | the design-time queue and each gate's result |
| `trade_proposals` | append-only + status | Piloted-class proposals; consumed/expired by the sleeve tick |
| `strategy_trials` | counter | the multiplicity ledger, keyed by strategy family |
| `capital_events` | append-only | the capital ledger; cash is derived from it |
| `equity_snapshots` | append-only | per-sleeve and system, per tick — the curves |
| `events` | append-only | the activity feed; `acknowledged_at` for criticals is its only mutable column |
| `candles_recent` | rolling window | last N days per instrument/timeframe for hot reads; archive in R2 |
| `transactions`, `accounts`, `category_rules`, `imports` | Money view | dedup hash unique-indexed |
| `reports` | append-only | metadata + R2 pointer to rendered content |
| `engine_telemetry` | rolling | every tick's timing/outcome; feeds the vitals |

## R2 (bulk, immutable)

- `candles/{venue}/{instrument}/{timeframe}/{yyyy-mm}.jsonl` — the append-only archive; the backtester's food. (JSONL over Parquet: sizes at this scale are tiny and JS-native beats a columnar dependency.)
- `books/{venue}/{instrument}/{yyyy-mm-dd}.jsonl` — top-of-book snapshots captured by the collector at tick boundaries; the fill simulator's input, persisted because simulated fills are audit surface.
- `snapshots/grants/{grant}/{tick-id}.json` — full audit of every AI tick: exact prompt, context inputs, raw response, validation result.
- `snapshots/gates/{proposal}/{gate}.json` — gate artifacts incl. reproducible backtest configs and results.
- `reports/{type}/{id}.md` — rendered report bodies.
- `backups/d1/{date}/…` — the scheduled export (blotter, events, capital) in plain CSV/JSONL.
- `backtests/{hash}.json` — every backtest result keyed by its reproducibility hash (config + code version + data window).

## Derivation rules (the honesty mechanics)

- **Positions and P&L**: `trades` and every equity figure derive from `orders` via pure recomputation. The recompute runs on every fill event and on demand; a cached value disagreeing with a fresh recompute is a `critical` event.
- **Cash**: derived by folding `capital_events`; the SystemDO holds the working copy and is the single writer of new events — operator capital acts reach it as recorded RPC calls from the review surfaces (06), never as direct row writes from anywhere else.
- **Staleness**: never stored — always computed at read time from `generatedAt + staleness window`, so a stopped clock can't fake freshness.
- **The feed is total**: every state-changing code path emits exactly one `events` row in the same transaction as its write. An action without its event is a bug the tests hunt explicitly.

## Money math

`BigDecimal` from `effect` everywhere; decimal strings at every serialization boundary; venue precision/lot-size rules applied through one `@app/core` module (`instrument.ts`) frozen per instrument at first use, so a venue changing its precision rules can never silently reinterpret history.
