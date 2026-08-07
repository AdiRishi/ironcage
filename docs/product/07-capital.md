# Capital & the allocator

The vision names three permanent parts: the engine, the cage, and the allocator. This document specifies the third — how money actually moves between the operator, the sleeves, and cash — and the system cage that sits above everything.

## The capital ledger

Ironcage tracks one number as sacred: **total system capital** — everything the operator has placed under the system's management. At all times it decomposes exactly:

> total system capital = unallocated cash + Σ (each sleeve's allocation)

- **Unallocated cash** is capital under management but assigned to no sleeve. It sits at venues (or in transit) earning nothing and risking nothing; it is visible in the [Money view](./04-money.md) and is the allocator's reserve.
- **A sleeve's allocation** is the capital currently entrusted to it — always ≤ its mandate's cap. A sleeve's _equity_ (allocation ± its P&L) fluctuates with performance; its _allocation_ changes only by allocator acts.

Dry-run sleeves have simulated allocations, tracked identically but never counted in real capital totals; the two are never conflated anywhere.

## Deposits and withdrawals

Money enters and leaves the system only by the operator's hand. A deposit or withdrawal is a recorded act (amount, venue, date, note) that changes total system capital and lands in unallocated cash first — never directly into a sleeve. Both are marked on every equity curve so growth is never misread as performance ([Overview](./01-overview.md)). A withdrawal larger than unallocated cash requires the operator to first reduce a sleeve — the system tells them so and by how much, and never sells anything to fund a withdrawal on its own.

## Allocation acts

All allocation changes are operator acts, recorded with reasoning and (where one exists) the report that informed them:

- **Fund** — move cash into a sleeve, up to its cap. Typically follows a trial report; always recorded against it when it does.
- **Reduce** — lower a sleeve's allocation. If the sleeve's deployed exposure exceeds its new allocation, it enters _drawdown-to-target_: no new entries until exposure falls below the target through normal exits. The operator may instead choose an immediate flatten — that is their explicit, separate choice; a reduction never force-sells on its own.
- **Return** — on retirement, everything comes back to cash and the sleeve's record closes.

The system never blocks an allocation act, and never performs one by itself. What it does is keep the ceremony honest: every act shows the sleeve's current evidence (trial report, capability scorecards, recent reviews) at the moment of decision, and records that it was shown.

## The system cage

Above every sleeve's own cage sits one system-wide set of limits, enforced independently — a sleeve operating perfectly within its own limits can still be stopped by the whole:

- **Total exposure cap** — deployed capital across all live sleeves may not exceed a set fraction of total system capital. An entry that would breach it is rejected (and recorded with that reason) even if the sleeve's own cage approved it.
- **System drawdown kill switch** — total live equity falling a set percentage from its high-water mark halts the entire system ([Operations](./06-operations.md)); every sleeve applies its winddown policy; leaving system Halted is a manual act from the incident report.
- **Venue concentration cap** — a maximum share of total capital at any single exchange or broker, so one venue failure cannot be a total failure. Funding a sleeve past it is flagged at the allocation act.

System cage limits are configuration with the same discipline as mandates: versioned, changed only through a reviewed act with written reasoning, and never touchable by any AI capability. Where a capability may tighten sleeve limits temporarily ([Sleeves](./02-sleeves.md)), nothing but the operator touches the system cage at all.

## What the operator sees

Capital has no separate view of its own; it surfaces where it is needed: the decomposition (cash vs. per-sleeve allocations vs. caps) and system-cage headroom in the [Money view](./04-money.md)'s portfolio picture and on [Overview](./01-overview.md); allocation acts and their reasoning in each sleeve's history and the [Activity feed](./03-activity.md); and the full allocation history — every act, ever — reconstructable like everything else.
