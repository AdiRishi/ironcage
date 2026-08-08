# Portfolio & the allocator

The Portfolio view is the whole of wealth in one place, and the allocator's home. The vision names three permanent parts — engine, cage, allocator — and this surface is where the third one lives: what the operator owns, where it sits, how it moves, how it is allocated and why, what running it costs, and how much room remains before the system cage pushes back. Where the Money view asks "how am I spending?", Portfolio asks "where is my wealth, and is it deployed the way the evidence says it should be?"

## The whole-of-wealth picture

- **Net worth over time** — sleeve equity (live and dry-run clearly separated) plus imported external account balances from [Money](./05-money.md), each component carrying its as-of date; stale imported balances are visibly dated, never silently presumed current.
- **Allocation** — the full breakdown: unallocated cash by venue (and in transit), external cash by account, each sleeve, and holdings by asset class.
- **The running FY tax estimate** — gains position, income to date, FITO accrued, election-threshold headroom — surfaced year-round from the [tax engine](./09-tax.md), so tax is a number the operator watches rather than an April surprise.
- This view feeds Overview's whole-of-wealth toggle ([Overview](./01-overview.md)).

## The capital ledger

Ironcage tracks one number as sacred: **total system capital** — everything the operator has placed under the system's management. At all times it decomposes exactly:

> total system capital = unallocated cash + Σ (each sleeve's allocation)

- **Unallocated cash** is capital under management but assigned to no sleeve. It sits at venues — or in transit between the bank and a venue — earning nothing and risking nothing; it is the allocator's reserve, and this view shows it plainly. The headline identity is venue-blind, but the ledger is not: cash is tracked per venue, because a dollar at Kraken cannot back an Alpaca sleeve until it physically moves.
- **A sleeve's allocation** is the capital currently entrusted to it — always ≤ its mandate's cap. Allocation is authority, not value: a sleeve's _equity_ (what its allocation is currently worth) fluctuates with performance, its _allocation_ changes only by allocator acts, and the nightly check that recorded value adds up is a separate assertion from this ledger.

Dry-run sleeves have simulated allocations, tracked identically but never counted in real capital totals; the two are never conflated anywhere.

## Moving money

The system can never move money itself — a structural fact, not a policy: venue API keys have no withdrawal rights (that is the security model's cornerstone), and no funding path exists anywhere in the system. Every physical transfer — bank to venue, venue to bank, venue to venue — is performed by the operator, with their own hands and their own credentials. The product's job is the choreography around that fact: **compute, request, detect, settle.**

- **Transfer requests.** When capital needs to be somewhere it isn't — a fund act needs cash at the sleeve's venue, the venue-concentration cap wants rebalancing, a withdrawal needs more than the unallocated cash at hand — the system computes exactly what to move and writes a **transfer request**: amount, source, destination, and rail (PayID/Osko for Kraken AUD; the recorded funding route for Alpaca), stated so the operator can comply in one banking session. Requests appear in Overview's attention items and are recommendations, not demands: the operator can fulfil, adjust, or dismiss one, and each outcome is recorded.
- **Dismissal is never a dead end.** Every request exists in service of something, and dismissing it resolves that something rather than orphaning it: a fund act awaiting the transfer is cancelled with it (recorded, and undone by simply funding again later); a withdrawal that needed it is cancelled likewise; a concentration-rebalance request dismissed records the operator's acceptance, and the breached headroom stays visible on this view instead of re-nagging. Nothing in the system waits forever on money the operator has decided not to move.
- **Pending, then settled.** Recording a deposit, withdrawal, or inter-venue transfer creates it as **pending**: expected amount, destination, and date. The scheduled venue-balance reconciliation detects the arrival (or departure) and **settles** the record against it — the same bank-leg-to-venue-arrival matching the tax engine performs on history, here running live. Until then the money shows as **in transit** in the capital decomposition: visible, counted in total system capital, and deployable nowhere.
- **Nothing is guessed.** A detected balance change with no pending record to match is surfaced for the operator to claim — adopted as a deposit only by their confirmation, never assumed. A pending transfer that misses its expected window, or arrives at a different amount (fees, FX), is flagged as a `warning` feed event for the operator to resolve; the record is corrected by their hand, never silently adjusted.

## Deposits and withdrawals

Money enters and leaves the system only by the operator's hand. A deposit or withdrawal is a recorded act (amount, venue, note) that follows the pending → settled lifecycle above, changes total system capital, and lands in unallocated cash first — never directly into a sleeve. Both are marked on every equity curve so growth is never misread as performance ([Overview](./01-overview.md)). A withdrawal larger than unallocated cash requires the operator to first reduce a sleeve — the system tells them so and by how much, and never sells anything to fund a withdrawal on its own; the venue-side withdrawal itself is the operator's manual act at the venue, detected and settled like any other transfer.

## Allocation acts

All allocation changes are operator acts, initiated here or from the sleeve's living view, and performed through the decision ceremony ([Operations](./07-operations.md)) — the sleeve's current evidence (trial report, capability scorecards, recent reviews) presented at the moment of decision, the act recorded with its reasoning and the evidence it was made on:

- **Fund** — move cash into a sleeve, up to its cap. Typically follows a trial report; always recorded against it when it does. If the cash is not yet at the sleeve's venue, the act is recorded immediately but sits visibly **awaiting funding**: a transfer request is issued, and the sleeve's effective allocation rises only when the money lands. Dismissing that request cancels the act — recorded like the act itself; nothing stays awaiting money that isn't coming. The decision is never blocked; the effect waits for reality.
- **Reduce** — lower a sleeve's allocation. If the sleeve's deployed exposure exceeds its new allocation, it enters _drawdown-to-target_: no new entries until exposure falls below the target through normal exits. The operator may instead choose an immediate flatten — that is their explicit, separate choice; a reduction never force-sells on its own.
- **Return** — on retirement, everything comes back to unallocated cash at its venue and the sleeve's record closes.

The system never blocks an allocation act, never performs one by itself, and never moves the money that backs one. The full allocation history — every act, ever, with its evidence — lives on this view, and each act is a feed event ([Activity](./03-activity.md)).

## The current book

Every open position across every sleeve, on one screen: instrument, sleeve, venue, size, entry, current price, stop, unrealized P&L, age — grouped by venue with per-venue totals against the venue concentration cap, and total deployed exposure against the system cage's exposure cap.

This is the emergency page: when the system halts or a venue degrades, the operator sees everything open, everywhere, without visiting five sleeve pages — with the always-available risk-reducing controls ([Operations](./07-operations.md)) beside each row. In calm times it is the same picture at rest: how much is at risk right now, and where. Each position opens its trade story ([Activity](./03-activity.md)).

## Costs

Costs are a first-class enemy, so they get an always-current display, not just a line in weekly reports: fees and slippage estimates per sleeve, AI spend per capability, and infrastructure — running totals for the month and year, shown beside the P&L they eroded. The reports do the analysis ([Reports](./06-reports.md)); this view does the noticing, so a drifting cost line is seen in days, not at month-end.

## The system cage

Above every sleeve's own cage sits one system-wide set of limits, enforced independently — a sleeve operating perfectly within its own limits can still be stopped by the whole. This view shows each limit with its current headroom:

- **Total exposure cap** — deployed capital across all live sleeves may not exceed a set fraction of total system capital. An entry that would breach it is rejected (and recorded with that reason) even if the sleeve's own cage approved it.
- **System drawdown kill switch** — total live equity falling a set percentage from its high-water mark halts the entire system ([Operations](./07-operations.md)); every sleeve applies its winddown policy; leaving system Halted is a manual act from the incident report.
- **Venue concentration cap** — a maximum share of total capital at any single exchange or broker, so one venue failure cannot be a total failure. Funding a sleeve past it is flagged at the allocation act, and rebalancing back under it is served by a transfer request.

System cage limits are configuration with the same discipline as mandates: versioned, changed only through a reviewed act with written reasoning, and never touchable by any AI capability. Where a capability may tighten sleeve limits temporarily ([Sleeves](./02-sleeves.md)), nothing but the operator touches the system cage at all.
