# Workbench

The research surface: historical data, reproducible backtests, the trial count, and the gate pipeline. Its automated customer is the proposal system; its interactive customer is the operator; both use the same machinery. The workbench's job, per the product spec: kill bad ideas early, kill lucky ideas reliably, and give survivors an honest number to carry into their trial.

## Historical data

The candle store ([Data](./03-data.md)) serves the workbench directly — same tables the ticks write, extended backward by backfill:

- **Backfill is a recorded act**: source (Kraken quarterly CSV archive, Alpaca history API, public-trades reconstruction), range, fetched-at, landing in R2 raw and `candles` normalized, closing gap-ledger entries. Kraken's API cannot serve deep history (720-candle window), so CSV seeding is the expected path, not a fallback.
- **Coverage is rendered from the gap ledger, never inferred**: the workbench UI shows per (instrument, timeframe) what ranges exist and where the holes are. A backtest whose window overlaps a hole says so on its face and in its stored result — it never interpolates.

## Backtest runs

A backtest is a run of `packages/engine` — the same strategy, cage, and fill-model code the live engine executes ([D14](./00-decisions.md#d14)) — inside the `ironcage-compute` container, against pinned inputs.

Every run starts from a **manifest**, stored with the result and sufficient to reproduce it:

- the complete configuration (a mandate version, or a candidate mandate from a proposal bundle),
- `packages/engine` version and fill-model version,
- the data window and a **content hash of the exact candle set** consumed (recomputed from the store at run time; a later re-run that produces a different hash is a data-integrity finding, not a quiet difference),
- the cost model: the venue's real fee schedule and the slippage parameters.

Execution: a Workflow (or an operator action) starts the run; the container reads inputs from Postgres/R2, executes deterministically — no wall clock, no unseeded randomness; the engine's purity makes this enforceable — and writes the full result to R2 with summary rows (headline stats, benchmark comparisons, risk statistics) to Postgres, returning pointers per the receipt discipline ([D4](./00-decisions.md#d4)).

**Walk-forward is the default shape** ([Workbench product spec](../product/08-workbench.md)): parameters fit on one window, evaluated on the next, rolled forward; the headline number is the stitched out-of-sample result. Single-window in-sample runs are supported for exploration and permanently labeled as the weaker thing. **A costless backtest does not exist**: the cost model has no off switch.

## The trial count

Multiplicity bookkeeping, enforced where trials run:

- Every backtest run increments a counter keyed by **strategy family** — the registry strategy name plus the sleeve/proposal lineage it serves. Family identity is assigned at run creation and immutable.
- Every comparative display and every trial report states the count: "best of N" is rendered *with* N, and the gate pipeline's acceptance thresholds scale with it — the multiplicity-corrected thresholds the product spec demands for AI-generated candidates are computed from this counter, so neither an enthusiastic operator nor a prolific proposer can launder a lucky draw by simply not mentioning the draws.

## The gate pipeline

One Workflow class runs every proposal ([Sleeves](../product/02-sleeves.md), [D13](./00-decisions.md#d13)), advancing the proposal row's state at each step and storing verdict + artifact pointers per step:

1. **Schema validation** — the proposal bundle (from its Artifacts commit) decodes against the mandate/strategy schemas; parameter values check against declared corridors. Cheap, immediate, kills malformed proposals without spending compute.
2. **Backtest reproduction** — the proposer's claimed backtest is re-run from its manifest in our container. Result must match within declared tolerance; a proposal whose evidence doesn't reproduce dies here, whoever proposed it.
3. **Walk-forward evaluation** — fresh walk-forward runs against the trial-count-adjusted thresholds.
4. **Shadow run** — the candidate runs as a **shadow sleeve**: a real sleeve actor created from the candidate configuration, ticking on live data through the ordinary engine machinery with simulated fills, flagged `shadow` and linked to its proposal — visible in the workbench's gate view, excluded from the roster, the allocator, and real capital accounting. The Workflow sleeps for the declared shadow window, then computes champion-vs-challenger comparison from both records.
5. **Operator approval** — `waitForEvent` for the ceremony's outcome. The timeout (generous — weeks) is caught, not propagated: an expired wait parks the proposal as `awaiting_approval` with a feed nudge, it does not fail the pipeline. Approval applies the change through the same mandate-version path as any operator edit ([Operations](../product/07-operations.md)); rejection archives everything.

Steps 2–4 run in the compute container or as shadow sleeves; the Workflow only orchestrates and records. A pipeline crash resumes from its last completed step; every step is idempotent on (proposal, step).

## Interactive use

The operator's workbench UI drives the same machinery: ad-hoc backtests (which increment trial counts like every other run), side-by-side comparisons that always carry their N, coverage maps, and the gate queue — each pending proposal with its verdicts so far. The research agent ([AI](./06-ai.md)) reads all of it through `AgentReadApi` and runs analyses in its workspace; what it cannot do is start a live sleeve, skip a gate, or touch a counter.

## What the workbench is not

Dry run is the proving ground; the workbench is evidence about the past. The lifecycle's dry-run stage exists because live markets are the only honest test of execution, data, and behavior together — nothing here substitutes for it, and no workbench number, however clean, promotes a sleeve by itself.
