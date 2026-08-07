# Engine

The engine is the deterministic half of the bargain: strategies, ticks, orders, fills, and reconciliation. It lives in two places — `packages/engine` (pure logic: strategy → cage → fills, no I/O, no Cloudflare) and `ironcage-core` (the actors that feed that logic reality and carry out its conclusions). This chapter specifies the strategy interface, the tick, the order-intent lifecycle, execution, the simulated-fill model, market data, reconciliation, and halts.

One property governs everything here: **given the same recorded inputs, the engine does the same thing.** Dry run, live, and backtest are one code path with different fill and venue adapters — that identity is what makes evidence transferable between them.

## Strategies

A strategy is **reviewed code in the strategy registry**, named by mandates — never configuration invented at mandate-authoring time ([Sleeves](../product/02-sleeves.md)). In code, a strategy is a pure module in `packages/engine`:

- **Identity**: a registry name and version. A mandate references both; changing strategy code that a live mandate references requires a new version and a mandate change — there is no editing a strategy under a running sleeve.
- **Parameters**: declared as an Effect Schema, with each tunable's type, bounds, and default. Parameter corridors ([Sleeves](../product/02-sleeves.md)) reference these declarations; a mandate's parameter values are validated against the schema at authoring time.
- **Interface**: a pure function of its inputs — the candle window it declared it needs, its own persisted working state, its parameters — returning its desired posture per instrument (target position, entry/exit signals, stop placement) and its next working state. No I/O, no clock access (the tick's timestamp is an input), no randomness. Purity is enforced socially by review and practically by the package boundary: `packages/engine` has no imports that could perform I/O.
- **Explainability**: alongside its posture, a strategy returns its _read_ — the named conditions it saw (e.g. trend direction, volatility state) that the living view renders. A strategy that can't explain itself in its output type doesn't pass review, matching the product rule that a strategy the operator can't explain doesn't get a sleeve.

## The tick

The sleeve actor's alarm fires just after a candle boundary (a small settle delay lets the venue finalize the candle). The tick is one Effect program; its steps, in order:

1. **Idempotency gate.** Compute the tick key `(sleeve, candle_close_ts)`. If a completed tick record exists, stop — the alarm's at-least-once delivery makes duplicates normal, not exceptional.
2. **Mode gate.** Check sleeve state and pause flag, and the system cage's mode. Halted, paused, or system-Halted → record the no-op, arm the next alarm, done.
3. **Data gate.** Fetch the closed candle(s) for the sleeve's universe and timeframe; verify completeness and freshness. A missing or partial candle → the sleeve **stands down**: a feed event records the gap and the declined evaluation, the vital degrades, next alarm armed. No evaluation happens on incomplete data, ever.
4. **Capability read.** Read the latest persisted output of each run-time capability the mandate holds ([AI](./06-ai.md)) — from Postgres, never by calling an agent: the AI already ran on its own schedule or it didn't. Stale or absent → that capability contributes its safe default (a regime multiplier of 0, an absent veto treated per its registry definition). This is where "AI is never awaited in the order path" is enforced.
5. **Strategy evaluation.** Run the strategy function on candles + state + parameters. Most ticks, the honest output is "no change" — recorded as engine telemetry, not a feed event.
6. **Clamp.** Apply the capability outputs to the strategy's desired posture through the deterministic combiner the mandate declares: multipliers multiply size down, locks veto entries, tightenings lower limits. The arithmetic — each input, each intermediate, the final effective size — is captured for the intent's context. Exits and stops are never clamped: no capability can keep a sleeve in a position.
7. **Sleeve cage.** Evaluate every rule in the mandate's risk limits against the clamped posture ([Cage](./05-cage.md)). The verdict — every rule, pass or fail, with distance to each limit — is recorded whether or not anything proceeds. Any failure → the intent is born rejected: a feed event with the full verdict, and the tick moves on.
8. **System cage reservation.** For an entry that survived, reserve exposure headroom from the system cage actor. Refusal → intent rejected with the system-cage reason, recorded identically.
9. **Intent persisted, then executed.** Write the intent row — full context, verdict, reservation — in the same transaction as its feed event and the in-flight marker. Only then hand it to the venue actor. The sleeve marks `executing intent X` before the call and clears it on settlement; a tick arriving mid-flight sees the marker and declines to act on that instrument.
10. **Settle and close.** On the venue actor's outcome: commit or release the reservation, update working state, flush the outbox, write the completed tick record, and arm the next alarm — `min(next candle boundary, outbox retry, in-flight follow-up)`.

Dry run executes this exact sequence; step 9 hands the intent to the **simulated venue adapter** instead of a real one, and every downstream row carries `simulated = true`.

## The order-intent lifecycle

States, owned as specified in [Data](./03-data.md) — created by the sleeve actor, advanced only by the venue actor:

```
pending ──▶ submitted ──▶ placed ──▶ filled
                │            │  └──▶ canceled
                │            └─────▶ rejected (venue)
                └──▶ failed (never reached venue, confirmed by query)
   (born rejected — cage verdict — is a terminal creation state)
```

- **`pending → submitted`**: the venue actor persists `submitted` _before_ the HTTP request leaves. From this moment, the intent is assumed possibly-known to the venue until proven otherwise.
- **Ambiguity resolution** ([D8](./00-decisions.md#d8)): on timeout or unclear response, the venue actor queries the venue for the intent's client-order ID. Found → adopt the venue's truth. Not found _and_ the Kraken `deadline` has passed → the original can no longer execute; safe to retry. Not found on Alpaca (no deadline mechanism) → retry only with the same client-order ID, whose active-order uniqueness makes the race harmless. **A blind retry does not exist as a code path.**
- **Fills** arrive by burst-polling while any order is live (every few seconds, backing off), and land as fill rows + feed events + position recomputation. Partial fills are ordinary: the order stays live, fills accumulate.

## Execution at the venue

The venue actor is the only code that speaks to an exchange, and it is deliberately dull:

- **Order placement** uses limit orders by default (the mandate may permit market orders per strategy need); every Kraken order carries `deadline` (a few seconds beyond our timeout) and the intent's `cl_ord_id`; every Alpaca order carries `client_order_id` and respects its fractional/notional constraints (day-TIF for fractional, notional as market-day orders — validated in paper before reliance).
- **Stops are venue-resident.** When a strategy's posture includes a stop, the venue actor places it as a real venue stop order and manages its moves. Intra-candle protection must not depend on our infrastructure being awake ([D7](./00-decisions.md#d7)). Stop placement, every move, and every trigger are blotter events.
- **Winddown** executes a halt's policy ([Sleeves](../product/02-sleeves.md)): `flatten-all` submits closing orders and cancels the rest; `keep-positions-cancel-orders` cancels working orders but leaves positions and their stops; `keep-all` touches nothing. A reconciliation-mismatch halt always behaves as `keep-all` regardless of policy — the system never trades on numbers in dispute.
- **Rate discipline**: the actor meters itself against the venue's published limits with headroom to spare; at this system's cadence the limits are never approached except during history backfills, which pace themselves.

## Simulated fills

Dry run and backtests share one fill model, versioned in `packages/engine` (the version is recorded on every simulated fill — a model change is visible in the data, and comparisons across model versions say so):

- **Market orders** fill at the next available price after the intent (in candle terms: the next candle's open), adjusted by a slippage estimate and charged the venue's real fee schedule for the order's type and the account's tier.
- **Limit orders** fill when the candle range crosses the limit price — conservatively: touching the price is not enough for a fill at better-than-limit assumptions, and fills never exceed what the candle plausibly offered.
- **Stops** trigger when the candle range crosses the stop level and fill with slippage _worse_ than the trigger, because that is what real stops do.
- **What the model does not simulate** — queue position, partial-fill dynamics, liquidity depth, venue outages — is a standing list in `packages/engine`, and the trial report's simulation-caveats section is generated _from that list_, so the product's honesty about dry-run limits is mechanically tied to what the code actually skips.

The model errs pessimistic by design: a strategy that only works with optimistic fills should die in dry run, not in production.

## Market data

- **Per tick**: the sleeve fetches its universe's closed candles from the venue's public API (Kraken OHLC / Alpaca bars), validates them (complete, expected close timestamp, sane values), and writes them to the candle store — the tick's fetch _is_ the collector at trading timeframes.
- **The candle store** ([Data](./03-data.md)) also serves the Workbench; deeper history arrives by backfill acts (Kraken's quarterly CSV archives; Alpaca's history API), each recorded with source and range, closing entries in the gap ledger.
- **Alpaca bar geometry**: hour-multiple bars anchor to UTC, not the exchange session — acceptable for this system's ETF cadences, recorded here so nobody "fixes" session alignment ad hoc later. If a strategy ever requires session-aligned bars, they are built from minute bars as a deliberate change.
- **A gap is a state, not an error**: sleeves that depend on the gapped data stand down (feed event, vital degraded) and resume when data does. Recovery requires no operator action.

## Reconciliation

On schedule, on engine startup, and after any connectivity loss, each venue actor reconciles ([Operations](../product/07-operations.md)):

1. Recompute expected balances, positions, and open orders from the blotter — independently of `positions_view`, so the projection is audited too.
2. Fetch the venue's actual state.
3. Compare within venue-precision tolerances. **Match** → a reconciliation record, vitals healthy. **Operator's own manual activity detected** (a trade or transfer done at the venue by hand) → adopted into the record as external-activity rows, noted in the feed; the system accounts for its operator, it doesn't fight them. **Unexplained mismatch** → the affected sleeve halts with winddown `keep-all`, a `critical` feed event fires, and the incident report is generated with both sides of the disagreement.
4. Expected transfer arrivals are matched to their pending records and settled here — reconciliation is where the capital ledger meets reality ([Portfolio](../product/04-portfolio.md)).

## Halts

A halt — from a sleeve cage rule, the system cage, reconciliation, or the operator's hand — always executes the same way: the sleeve actor transitions state (recorded, feed event), asks its venue actor to execute the winddown policy, and thereafter its ticks are mode-gated no-ops until the operator acts from the incident report. The system-cage kill switch does the same across every sleeve at once, and the one interruption ([D19](./00-decisions.md#d19)) is sent through the outbox — a halt email that must eventually arrive, retried until it does.
