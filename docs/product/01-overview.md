# Overview

Overview is the five-second answer. Its job is singular: the operator opens the app and knows immediately whether everything is okay — and if not, what needs them. Everything on this view is a summary with a path to detail; nothing on it is the only place a fact lives. How its contents are arranged is a design decision made elsewhere; this document defines what Overview must convey and how that information must behave.

## The five-second test, operationally

"Everything is okay" is a defined state, not a feeling: every system vital is healthy, and no items are awaiting the operator's attention. Whether that state holds must be apparent immediately on opening the view, without hunting. If the operator has to search to find out whether something is wrong, this view has failed its spec.

## What Overview conveys

### System vitals

The health of every load-bearing part of the system, each with three states — healthy, degraded, failing — and a plain-language label:

- **Engine** — age of the last tick per active sleeve cadence. Degraded when a tick is overdue; failing when overdue by more than one full interval.
- **Market data** — freshness per venue. Degraded on delay; failing on a gap that has caused any sleeve to stand down.
- **Venue connectivity** — reachability of each connected exchange/broker (and the gateway, once live capital exists). Failing means affected sleeves are failing closed.
- **AI runs** — status of the last scheduled AI work (regime ticks, report generation). A failed run is a degraded vital and a feed event; the affected sleeve independently shows its stale-signal state.

Vitals are honest about staleness: every value carries its "as of" time, and a value the app cannot currently refresh reports as unknown (degraded), never as its last known healthy reading.

If a break-glass override is armed or active, that fact — with its scope and expiry — is unmissable on this view regardless of anything else.

### Items awaiting the operator

Everything that needs a human, and nothing else (absence of items is the good state):

- Pending trial reports awaiting a promotion decision.
- Unacknowledged critical events (see [Activity](./03-activity.md) — criticals persist here until acknowledged).
- Halted sleeves, with the halt reason and a link to the incident report.
- An armed or active override approaching expiry.
- Outstanding transfer requests — money the system needs the operator to move ([Portfolio](./04-portfolio.md)), with amount, destination, and rail — and any pending transfer that has missed its expected window.

Every item here opens the decision it is waiting on, through the decision ceremony ([Operations](./07-operations.md)) — this row is the product's entire to-do list, and an empty row is the good state.

### The equity picture

Portfolio equity over time, viewable across standard windows (week, month, quarter, year, all):

- Total across all sleeves, with the option to include imported external balances from [Portfolio](./04-portfolio.md) (whole-of-wealth mode).
- **Dry-run and live equity are never conflated** — they are distinguishable at a glance, with the moment of any sleeve's promotion identifiable.
- Deposits and withdrawals are identifiable on the curve so growth is never misread as performance.
- Alongside the curve: total P&L (today / 30 days / all-time), always net of costs.

### The sleeve summary

For every non-retired sleeve, at a glance:

- Name and market (crypto / stocks / …)
- State (Draft / Dry run / Live / Halted, with the halt reason discoverable; a paused running sleeve is visibly flagged)
- Profile and capability count (Clockwork / Advised / Assisted-design / Piloted; any suspended capability flagged)
- Current allocation vs. mandate cap
- P&L today and all-time, net of costs
- Recent equity trajectory
- For sleeves with run-time capabilities: the current effective entry multiplier per instrument (or a summary of it) and its freshness — stale inputs presenting as their most restrictive default. A Clockwork sleeve shows its drift from target weights here instead — each sleeve's summary speaks its own mandate's language ([Sleeves](./02-sleeves.md)).
- Time until its next scheduled action

Each sleeve's summary leads to its [living view](./02-sleeves.md).

### Recent activity

The most recent feed events, with warnings and above given prominence, leading into the full [Activity feed](./03-activity.md).

## Liveness

Overview updates continuously while open — new fills, regime changes, and vital transitions appear without a manual refresh, within seconds of the underlying event. Every piece of data carries its "as of" timestamp. The view losing its connection to the backend is itself a degraded state the operator can see — the observatory never displays dead data as live.
