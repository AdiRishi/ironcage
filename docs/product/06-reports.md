# Reports

Reports are the documents Ironcage writes: scheduled reviews, on-demand trial reports, and post-halt incident reports. They are where AI does synthesis at its best — reading the recorded data and telling the operator what it means — under rules that keep that synthesis grounded in the record.

## Rules that bind every report

- **Generated from recorded data only.** A report is written from the blotter, the feed, the mandates, and the imported transactions — never from an AI's general impressions. Every claim links to the records that support it; a claim that can't be traced doesn't belong in the report.
- **Reports recommend; they never act.** No report changes an allocation, a mandate, or a position.
- **Failed generation is a feed event** (`warning`), never silence. A missing report is a visible fact.
- **Reports are permanent.** The library keeps every report ever generated, unread ones marked.

## The types

### Weekly sleeve review — per active sleeve, weekly

What the sleeve did (trades, exposure, notable decisions); performance for the week and cumulatively vs. its declared benchmarks; costs incurred (fees, spread/slippage estimates, AI spend attributable to the sleeve); risk behavior (drawdown, distance to limits, any warnings or rejections); **each capability's week**: its scorecard movement vs. its no-AI baseline, notable outputs (vetoes placed, tightenings applied, proposals submitted), and any suspension; whether live/dry-run behavior tracked backtest expectation, with divergences flagged; and anything anomalous, in plain language.

### Weekly portfolio review — one, weekly

The whole system in one page: total performance, per-sleeve contribution, the system cage's headroom, open questions across sleeves, and the capability scoreboard — every active capability's running score against its no-AI baseline, stated plainly ("the regime assessment added/cost X this period; cumulative verdict: earning its keep / not yet / failing"), so the question "is the AI worth it?" always has a current, numeric answer.

### Monthly spending report — monthly, after import

The month's spending by category vs. trailing averages; income, spending, savings rate; recurring-charge changes; anomalies; and the current stack of savings suggestions with estimated annual impact. The report is generated only when every required Money account covers the full month. An incomplete month shows its account-level gaps instead of a partial report. Written to be read in three minutes.

### Trial report — on demand, and automatically when a sleeve seeks promotion

The evidence for an allocation decision: the trial period and what ran; performance vs. every benchmark the mandate declared (including the no-AI baseline where capabilities are held); the scorecard of every capability; risk profile (max drawdown, worst day, loss streaks); full cost accounting; behavior conformance (did it do what the mandate says — including how often the cage rejected its intents and why); simulation caveats (what dry-run fills can't prove about live execution); and a recommendation with reasoning. Where a trial exists because an AI capability proposed the sleeve or its parameters, the report states its acceptance thresholds with multiplicity corrections applied — many candidates means lucky flukes, and the report says so out loud. The promote/defer decision is made through the decision ceremony ([Operations](./07-operations.md)) and recorded against this report — either way.

### Incident report — automatically, on any halt or reconciliation mismatch

What halted and which rule fired, at what value; the timeline reconstructed from the feed; the state at halt (positions, orders, equity); what the winddown policy did; and the open questions the operator should answer before un-halting. Un-halting requires the operator to have opened this report — the un-halt ceremony ([Operations](./07-operations.md)) enforces it; resuming without seeing the evidence is not a path the product offers.

## The library

The Reports view lists everything, filterable by type, sleeve, and date, with unread indicators. Each report renders in the app (no downloads required), shows its generation time and data-window, and links back to every record it cites.
