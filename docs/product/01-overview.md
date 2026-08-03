# The Overview view

Overview is the front page and the five-second answer. Its job is singular: the operator opens the app and knows immediately whether everything is okay — and if not, what needs them. Everything on this view is a summary with a path to detail; nothing on it is the only place a fact lives.

## The five-second test, operationally

"Everything is okay" is a defined state, not a feeling: the health strip is fully green, and the attention row is empty. Any deviation from that state is visible above the fold without scrolling. If the operator has to hunt to find out whether something is wrong, this view has failed its spec.

## Layout, top to bottom

### 1. Health strip

A single row of system vitals, each a colored chip (green / amber / red) with a plain-language label:

- **Engine** — age of the last engine tick per active sleeve cadence. Amber when a tick is overdue; red when overdue by more than one full interval.
- **Data** — market-data freshness per venue. Amber on delay; red on a gap that has caused any sleeve to stand down.
- **Venue connectivity** — reachability of each connected exchange/broker (and the gateway, once live capital exists). Red means affected sleeves are failing closed.
- **AI** — status of the last scheduled AI runs (regime ticks, report generation). A failed run is amber here and a feed event; the affected sleeve independently shows its stale-signal state.
- **Override banner** — if a break-glass override is armed or active, a prominent banner appears here regardless of anything else, with its scope and expiry countdown.

Chips are honest about staleness: every value shows its "as of" time, and a value the app cannot currently refresh renders as unknown (amber), never as its last known green.

### 2. Attention row

Items requiring the operator, rendered as cards; the row is hidden when empty (emptiness is the good state):

- Pending trial reports awaiting a promotion decision.
- Unacknowledged critical events (see [Activity](./03-activity.md) — criticals persist here until acknowledged).
- Halted sleeves, with the halt reason and a link to the incident report.
- An armed or active override approaching expiry.

### 3. Equity hero

The portfolio equity curve, drawn large:

- Total across all sleeves, with a toggle to include imported external balances from the [Money view](./04-money.md) (whole-of-wealth mode).
- **Dry-run and live equity are never visually conflated** — separate series, unmistakably distinguished, with the boundary marked when a sleeve was promoted.
- Deposits and withdrawals are marked on the curve so growth is never misread as performance. Alongside the curve: total P&L (today / 30d / all-time) computed net of costs.
- Timeframe controls (1w / 1m / 3m / 1y / all).

### 4. Sleeve table

One row per non-retired sleeve:

| Column | Content |
| --- | --- |
| Name | With its market badge (crypto / stocks / …) |
| State | Chip: Draft / Dry run / Live / Halted (with reason on hover) |
| Autonomy | L0 Clockwork / L1 Advised / L2 Piloted |
| Allocation | Current allocation vs. mandate cap (e.g. "$800 / $1,000") |
| P&L | Today and all-time, net of costs |
| Curve | Sparkline of the sleeve's recent equity |
| Regime | For L1+: current assessment (ON / HALF / OFF) with age; stale renders as OFF (stale) |
| Next action | Countdown to the sleeve's next scheduled tick |

Clicking a row opens the sleeve's [living view](./02-sleeves.md).

### 5. Feed head

The most recent activity events (default: last 10, warnings and above always surfaced first), linking into the full [Activity feed](./03-activity.md).

## Liveness

Overview updates continuously while open — new fills, regime changes, and health transitions appear without a manual refresh, within seconds of the underlying event. Every panel carries its data's "as of" timestamp. The page going stale (lost connection to the backend) is itself an amber state on the health strip, not a silent freeze.
