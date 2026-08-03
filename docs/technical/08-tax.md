# The tax engine

The runtime for `docs/product/09-tax.md`: source connectors, the canonical event pipeline, the translation and forex layer, the parcel/basis engine, income and offset ledgers, and the verification machinery. The engine — classification, matching, translation, basis, aggregation — is pure code in `@app/core/tax`: same events in, same report out, every time (a determinism test enforces byte-identical re-runs in CI and before every report).

## Where it runs

Sync runners live in `apps/jobs` (cron, per source, incremental); parsers, matching, and the engine are pure functions in `@app/core/tax`; raw source payloads archive to R2; canonical state lives in D1. Nothing here touches trading paths — the arm is read-only by construction.

Key custody follows the standing rule by *capability*: **broker and exchange API keys — even read-only ones — are venue keys and live only on the gateway**, which grows read-only `/tax/:venue/…` routes (activities, ledgers, balances, documents) for the sync runners. Data-provider keys that can neither move money nor expose account credentials (block explorers, price APIs) are ordinary Worker secrets.

## Source connectors

| Source | Method | Known constraints (built into the gap ledger) |
| --- | --- | --- |
| Ironcage sleeves | The blotter, directly | none — native records, both venues |
| Kraken | Ledger + trade export via the report-export API (one shot for full history), incremental ledger sync thereafter | ledger is canonical incl. staking (`.S`/`.B` assets → normalize to base), fiat funding, and **fiat-to-fiat legs** (an AUD/USD trade appears as paired ledger entries sharing a refid — an actual achieved FX rate, fed to the forex module); instant-convert flows emit `conversion`/`spend`/`receive` types and are treated as disposals/acquisitions too |
| Alpaca | The account-activities stream as primary record: `FILL`; `DIV` + `DIVNRA` (the US non-resident withholding line) + `DIVCGL`/`DIVCGS`/`CGD`/`DIVROC`/`DIVTXEX`; `INT`/`INTNRA`; `FEE`/`CFEE`; `CSD`/`CSW`/`TRANS`; corporate-action types (`SSP`/`SSO`/`MA`/`NC`/`SC`/`REORG`). The corporate-actions data API supplies ratios. The 1042-S is archived annually | **Alpaca's own cost-basis figures are unusable for AU tax** (USD, compressed-FIFO, no lot API) — the engine builds its own AUD lot ledger from fills; 1042-S retrieval may be a dashboard download on retail accounts (manual upload path exists); AUD→USD funding conversions happen outside Alpaca, so each `CSD` records its actual conversion rate when the operator supplies it, RBA fallback otherwise |
| Coinbase / Binance / other exchanges | As previously specified (v2 transactions + fills; statement-export CSVs for old history + windowed API sync) | Binance statement CSVs remain the only reliable old-history source |
| Wallets (BTC/LTC xpub; ETH; ADA/DOT/SOL as configured) | As previously specified (Blockbook xpub; address history + archive-call snapshots for pooled staking; per-epoch reward endpoints) | Everstake pool rewards invisible in tx history — reconstructed from balance snapshots; receipt-point setting explicit |
| Bank (Money view) | Interest lines identified from imported transactions; AUD legs of broker/exchange funding matched to their arrival events | classification rules mark interest vs transfers; domestic interest stays on its own return item |
| Manual CSV | The Money-view import machinery with a tax-event mapping step | operator maps unrecognized columns once; mapping saved |

Every sync records its fetch windows to the **gap ledger** (`tax_sync_windows`); coverage per source is computed, and holes render in the product as holes.

## The canonical event

`@app/contracts/tax` defines `TaxEvent`: source + source ref (idempotency key, unique-indexed), timestamp, kind (`acquire | dispose | transfer-out | transfer-in | income-staking | income-dividend | income-interest | income-airdrop | income-other | withholding | fee | spend | gift-out | gift-in | corporate-action | fx-convert | lost`), asset (crypto symbol, equity symbol, or currency), amount, counter-asset and amount where applicable, **AUD valuation with `rateSource` provenance**, classification flags (personal-use opt-in, wrap-override, receipt-point, distribution class), and the raw-payload R2 pointer. Normalizers never guess: unrecognized source records become review-queue rows.

## The pipeline

```
sync (per source, incremental, windows → gap ledger)
  → normalize (source records → TaxEvents; unknowns → review queue)
  → match (own-transfer matching: same asset, opposite directions,
     ≤12h, fee tolerance → transfers, not disposals; crypto network-fee
     units → fee-disposals per ATO guidance; funding matching: bank AUD
     leg ↔ broker/exchange arrival; DIV ↔ DIVNRA pairing by symbol+date)
  → translate (every foreign-currency amount → AUD at its own event
     date: RBA daily default, ATO monthly-average option, actual-achieved
     rate where a real conversion backs the flow; provenance stored)
  → classify (deterministic rules first; ambiguous → review queue with
     validated AI suggestions, operator-confirmed — never silent)
  → corporate actions (splits → parcel quantity/cost adjustment, no CGT
     event; mergers/spinoffs → CGT events flagged with rollover-
     eligibility for review; ratios from the corporate-actions API)
  → basis engine (pure): parcel pools per asset across all classes;
     FIFO default, HIFO/LIFO as specific-identification variants;
     AUD cost bases; disposal ledger with per-parcel dates → discount
     eligibility; DIVROC → cost-base reduction (G1 on excess)
  → forex module (Division 775): election ON (default) — cash-balance
     FX disregarded, election document generated, A$250k threshold and
     buffer monitored with alerts; election OFF — currency lots, FIFO,
     realisation gains/losses as ordinary income; either way, per-event
     translation above is unaffected
  → income & offsets: income ledger by type/source; withholding ledger;
     FITO computation (direct claim ≤ $1,000; offset-limit calculation
     above it, using the operator-supplied full income picture; unused-
     offset warning); W-8BEN validity tracked
  → FY aggregation: item-18 figures (losses to non-discountable gains
     first, operator-overridable; 50% discount on the remainder; CGT-
     schedule flag), item-20 figures (assessable foreign income, net,
     FITO, the A$50k foreign-assets answer from computed peak balances),
     domestic interest, forex lines when tracking is on
  → report generation (Reports library) + running FY estimate
```

Derived stages (parcels, disposals, currency lots, aggregates) are rebuildable from `tax_events` at any time. Elective and contested positions (Div 775 election, wrap-as-disposal, transfer-fee treatment, staking receipt point, distribution classes, parcel method) live in versioned `tax_settings` with the same change discipline as mandates — and the settings history is itself part of the records, since method consistency is part of defensibility.

## The rate & price service

One service, two jobs. **Crypto prices**: transaction-embedded price first, direct AUD candles second, USD candles × RBA AUD rate third, aggregator last — as previously specified. **Fiat rates**: RBA daily AUD/USD (the ATO's own source) cached locally; ATO monthly averages loaded as an alternative table; actual-achieved rates captured from real conversions (Kraken fiat legs; operator-supplied funding conversions). Every stored valuation records source, granularity, and fetch time.

## Verification machinery

Everything from the crypto specification — per-source balance reconciliation, missing-basis flags, the gap ledger, the one-time Summ oracle check, full traceability — plus two cross-document checks: the year's computed US withholding total reconciles against the archived **1042-S**, and exchange-sourced disposals reconcile against what the ATO's crypto data-matching program receives from Australian exchanges. A reconciliation failure is a visible per-source error and a `warning` feed event until resolved.

## D1 additions

As previously specified (`tax_sources`, `tax_sync_windows`, `tax_events`, `tax_review_queue`, `transfer_matches`, `tax_settings_versions`, `price_cache`, derived `tax_parcels`, `tax_disposals`, `tax_fy_summaries`) plus: `fx_rates` (RBA daily + monthly-average tables), `currency_lots` (forex mode), `withholding_ledger`, `tax_documents` (W-8BEN validity, election document, 1042-S archive refs → R2). Raw payloads: R2 `tax/raw/{source}/{yyyy-mm}/…`.

## Open items (resolve at build, each with a recorded answer)

Whether a brokerage cash balance qualifies for the limited-balance election (reasonable position: yes; consider a private ruling if balances grow); AU characterisation of US fund capital-gain distributions (default: foreign income, flagged — materiality near zero for broad-market ETFs); 1042-S API retrievability on a retail Alpaca account; the return labels for non-elected forex gains/losses; AUDUSD pair availability on the operator's Kraken account region.
