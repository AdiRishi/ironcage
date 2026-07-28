# Ironcage — Product Specification

The [vision](./VISION.md) is the goal and direction: what Ironcage is and why it must exist. This specification is the specifics: what the system actually does, surface by surface, to achieve that vision. Where the two conflict, the vision wins and this specification is wrong. Terms are defined in [`CONTEXT.md`](../CONTEXT.md).

## Product shape

Ironcage is a headless system with three human surfaces: a **web dashboard** (observe), a **Telegram channel** (be told), and a **weekly review** (be advised). There is exactly one operator. The system runs continuously in the cloud; the operator's job is oversight, not participation — the design goal is that touching it daily is unnecessary and touching it weekly is enough.

## Modes

The system is always in exactly one mode, and mode changes are explicit, logged operator actions:

- **Dry run** — the default and the proving ground. Full pipeline against live market data, simulated order-book-aware fills, simulated wallet. Indistinguishable from live in code path and in every surface (the dashboard renders a dry-run banner; nothing else differs).
- **Live** — real orders through the gateway. Requires: a completed dry-run period, the risk cage config reviewed, and exchange keys that are IP-locked to the gateway with withdrawals disabled.
- **Halted** — entered automatically (daily loss halt, kill switch, unrecoverable reconciliation failure) or manually. Open positions are handled per the halt's winddown policy; no new entries. Leaving `Halted` is always manual.

## The core loop (what the operator sees)

1. **The engine trades** — or declines to. Every candle close it evaluates the strategy, reads the current regime signal, applies the cage, and acts. Most ticks correctly do nothing.
2. **Telegram tells the story in real time.** Every entry, exit, regime change, halt, and error posts a message. Silence means "nothing happened", and that must be trustworthy — delivery failures are themselves alerts on the dashboard.
3. **The dashboard answers "how is it going?"** — equity curve (with dry/live boundary marked), open positions with stops and unrealized PnL, trade log with entry/exit tags and the regime state each trade was born under, current regime signal with rationale and age, cage status (limits vs. current usage, active pair locks), and system health (last tick, last data refresh, gateway reachability).
4. **The weekly review answers "should anything change?"** — an LLM job reads the blotter and equity curve, compares live behavior to backtest expectations, and writes a short report: what worked, what didn't, whether the regime layer is earning its keep against the control, and anything anomalous. The review recommends; it never acts.

## The regime signal, as a product surface

The signal is always visible and always explainable: current state (`ON`/`HALF`/`OFF`), confidence, the one-paragraph rationale, which sources fed it, when it was generated, and when it goes stale. A stale or missing signal renders as `OFF (stale)` — the operator should never have to wonder what the system will do in ambiguity: it stands down.

## Guarantees surfaced to the operator

- **Nothing is hidden.** Every order intent — including rejected ones — appears in the log with the cage's verdict and reasons. A rejected intent is a feature working, and is displayed as such.
- **Numbers reconcile.** Dashboard equity is recomputed from the blotter; the blotter is reconciled against the exchange. Discrepancies halt the system rather than being papered over.
- **The audit trail is complete.** From any trade, the operator can walk back to: the strategy signal and candle that triggered it, the regime signal in force (and its full tick snapshot — prompt, sources, response), the cage evaluation, and every order event through fill.

## The milestone ladder

Capability arrives in strict order; each milestone is usable and honest on its own:

- **M0 — Foundations.** Monorepo, docs, schemas, data collection (candles flowing into storage on schedule). No trading of any kind.
- **M1 — Core engine, offline.** Strategy, cage, blotter, and fill simulator complete and unit-tested; backtester runs walk-forward over collected history against baselines. Produces the strategy's honest numbers.
- **M2 — Dry run, live data.** The full loop runs continuously in dry-run mode; dashboard v1; Telegram alerts. This milestone is where the system earns trust, over months, not days.
- **M3 — The brain.** Regime worker live: LLM ticks, schema-validated signals, audit snapshots, weekly review. The ON/HALF/OFF variant runs beside a no-LLM control.
- **M4 — Live capital.** Gateway deployed on a static-IP host; exchange keys IP-locked, withdrawals disabled; small real capital under the full cage. Entered only on evidence from M2/M3.

## Explicitly out of scope

Multi-user anything, mobile apps, strategy marketplaces, leverage, shorting, derivatives, sub-hour trading cadence, and any surface that lets the LLM take an action. If a feature idea requires weakening a guarantee in this document, the feature is wrong.
