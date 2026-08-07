# Money & Tax

The read-only surfaces' machinery: the bank-import pipeline, deduplication, categorization, and the tax engine. Product behavior is specified in [Money](../product/05-money.md) and [Tax](../product/09-tax.md); this chapter specifies how it's built. Everything here reads and computes; nothing trades.

## Bank import

**Formats.** CSV and OFX from NetBank web export, auto-detected. QIF is not implemented (no IDs, ambiguous dates — strictly worse than CSV). PDF statements are deferred, not needed: CommBank PDFs are text-based (no OCR ever required), and matter only for history older than the export window — a later, deliberate addition.

**Parser facts the implementation must honor** (empirically established, encoded as parser tests):

- CSV is headerless, four columns: date (`DD/MM/YYYY`, posting date), signed amount (positives often carry an explicit `+`), narrative, running balance. **Credit-card exports omit the balance.**
- The narrative embeds structure: `Value Date: DD/MM/YYYY` (the authorization date — and not only on card rows), card suffixes (`Card xx1234`), truncated merchant names padded with variable whitespace. Whitespace is rendering, not delimiting — collapse before deriving anything.
- **Exports contain posted transactions only** — pendings never appear, so no pending→posted mutation handling exists in v1. This is a simplification the design leans on deliberately.
- The export window is volume-dependent and can be far shorter than commonly claimed; the flow assumes **chunked, overlapping exports** as the normal case, which is why dedupe is a first-class subsystem and not an edge case.
- OFX may carry `FITID` transaction IDs for deposit accounts and not for cards — treated as an _opportunistic accelerator_, verified per account type at first import, never the sole key.

**Flow**: parse → normalize → dedupe → preview (n found / m new / d duplicates / k needing review) → operator confirms → write transactions + import row + feed event. Nothing writes before the confirm.

## Deduplication

Three tiers, evaluated in order, all scoped per account ([D-research recorded in Data](./03-data.md)):

1. **`FITID` exact match**, where OFX provided one and prior imports stored it.
2. **Content key**: hash of (account, posted date, amount, normalized narrative), plus an **occurrence index** for identical same-day rows (two identical coffees are two rows: first import's occurrence 1 and 2; a re-import maps onto them stably). Normalization strips value-date stamps, card suffixes, and batch IDs, collapses whitespace, uppercases — and is **versioned**: the raw narrative is the durable fact, the key a derived column recomputable when the normalizer improves.
3. **Balance-chain verification** (deposit accounts only): the running balance must satisfy `balance[n] − balance[n−1] = amount[n]` within each import, and the overlap region of two imports must produce an identical chain. This deterministically catches both duplicates _and_ gaps — the check no pure hash scheme can make — and its result is stored on the import row. A chain violation blocks the import with a precise diff; it is never auto-resolved.

A claim-once discipline during matching (each stored row matches at most one incoming row per import) prevents N incoming duplicates collapsing onto one stored row.

## Categorization and analysis

- **Rules first, model second** ([AI](./06-ai.md)): a rule-matched transaction never reaches a model; the rest go to the categorization capability, whose high-confidence assignments apply and low-confidence ones queue for review. Corrections write rules; rules are visible, editable rows.
- **Own-transfer detection** pairs opposite-signed rows across the operator's accounts within a date tolerance and excludes them from spending analysis; a pairing is recorded on both rows.
- **Analysis is SQL over the record**: monthly by category vs trailing averages, trends, savings rate — computed views, every aggregate one query from its rows. **Recurring charges** are detected by (normalized payee, amount tolerance, cadence regularity); a detected charge is a row whose amount history drives the price-change feed events. **Anomalies** (large transactions, new payees above threshold, category spikes) are threshold rules over the same data, surfaced as `notice` events.

## The tax engine

Architecture in one sentence: **sync workflows pull raw history per source into R2, a normalizer turns raw records into canonical `tax_events` rows with provenance, a pure computation package turns events into parcels, income, and the FY figures, and a verification layer refuses to let any of it look more certain than it is.**

### Sources and sync

Each source has a sync Workflow, on schedule or on demand, writing raw pages to R2 and normalized events to Postgres, and updating the source's **gap ledger** (`tax_source_coverage`) — which windows were fetched from where; holes render as holes:

- **Ironcage's own venues** — native: the blotter already is the record; a thin mapper emits events (fills → acquisitions/disposals, fees, and Kraken's per-fill fee _asset_ respected).
- **Kraken full history** — the export API (`AddExport`/`RetrieveExport`) for bulk trades + ledgers rather than paged endpoints; the **ledger is the spine** (staking/earn rewards appear as ledger entries; there is no separate rewards endpoint).
- **External exchanges** — read-only API keys, same shape; statement-file ingestion where APIs can't reach old history, with the file recorded as the source.
- **Wallets** — xpub-based tracking for UTXO chains, address-based for account chains including tokens, via a configured chain-data provider; per-chain staking-reward reconstruction as its own normalizer concern.
- **Alpaca** — the account-activities stream, cursor-paged from the beginning: fills, `DIV` with its `DIVNRA`/`DIVTW` withholding lines, fees, interest, and corporate-action codes (`SPLIT`, `SPIN`, `MA`, `REORG`). The 1042-S is a manual annual upload, archived in R2, reconciled — not a source of events.
- **Bank interest** — identified from Money's imported rows by narrative patterns (`Credit Interest`, `Bonus Interest`, TFN-withholding lines _including the bank's own misspelling_), matched case-insensitively; also the AUD legs of broker/exchange funding flows.
- **Manual CSV** — same normalization, same audit trail.

The prior tax service's export is imported **once, as a verification oracle**: compared, differences itemized and resolved or explained — never merged as data.

### Normalization and matching

Every raw record maps to canonical events (acquisition, disposal, transfer, income, withholding, fee, spend, gift, corporate action) carrying timestamp, asset, quantity, **AUD valuation + rate source**, source reference. Cross-source matching runs after each sync: transfer legs between the operator's own accounts/wallets pair up (not disposals; the network fee is), funding flows match their bank leg to their venue arrival. Anything unmatched, unrecognized, or below confidence lands in the review queue — **flagged, never guessed** is implemented as: an unrecognized shape produces a review item and _no_ event, so the computation never ingests a guess.

### Computation

`packages/tax` — pure, deterministic, versioned like the engine: events in, figures out.

- **Parcels**: specific identification, FIFO default (HIFO/LIFO as recorded variants); disposals consume parcels and record which, at what cost base, with discount eligibility (≥ 12 months, after losses, losses applied to non-discountable gains first, operator-overridable).
- **Currency**: every USD amount translated at transaction date (RBA daily default; monthly-average and actual-achieved-rate alternatives recorded per event). The USD balance itself follows the elected Division 775 mode; the **limited balance election** is the supported default — the engine generates the election document, tracks the A$250k threshold with a buffer alert.
- **Foreign income**: dividends grossed up with treaty withholding; FITO accrual with the $1,000 direct-claim threshold and the offset-limit calculation above it; W-8BEN expiry tracked as a dated fact with an attention item before lapse.
- **Corporate actions**: splits adjust parcels silently (no CGT event); everything else (mergers, spinoffs) generates a flagged review item with rollover eligibility noted — processed only by operator resolution.
- Recomputation is total, not incremental: the FY figures are re-derived from the full event set on every run, because at this volume correctness beats cleverness and incremental state is a bug farm.

### Verification

Runs with every recomputation; failures are feed events and attention items, never absorbed: per-source balance reconciliation (computed holdings vs live exchange/chain/broker balances), zero-basis flags (disposal exceeding tracked acquisitions — costed at zero _visibly_), the gap ledger, the 1042-S cross-check (computed withholding vs the broker's form), and the one-time oracle comparison. Every figure on the FY report walks back to events, every event to its raw source record in R2.

The FY report itself is a report like any other ([Data](./03-data.md)): generated into R2, shaped as myTax asks, with the per-disposal, income, withholding, and carried-loss ledgers behind the headline figures; the running FY estimate is the same computation on the year-to-date event set, surfaced on Portfolio.
