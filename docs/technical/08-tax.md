# The tax engine

The runtime for `docs/product/09-tax.md`: source connectors, the canonical event pipeline, the parcel/basis engine, the price service, and the verification machinery. The engine itself — classification, matching, basis, aggregation — is pure code in `@app/core/tax`: same events in, same report out, every time.

## Where it runs

Sync runners live in `apps/jobs` (cron, per source, incremental); parsers, matching, and the basis engine are pure functions in `@app/core/tax`; raw source payloads archive to R2; canonical state lives in D1. Nothing here touches trading paths — the arm is read-only by construction.

Key custody follows the standing rule by *capability*: **exchange API keys — even read-only ones — are venue keys and live only on the gateway**, which grows read-only `/tax/:venue/…` routes (history, balances) for the sync runners. Data-provider keys that can neither move money nor expose account credentials (block explorers, price APIs) are ordinary Worker secrets.

## Source connectors

| Source | Method | Known constraints (built into the gap ledger) |
| --- | --- | --- |
| Ironcage sleeves | The blotter, directly | none — native records |
| Kraken | Ledger + trade export via the report-export API (one shot for full history), incremental ledger sync thereafter | ledger is canonical incl. staking (`.S` assets), fiat funding |
| Coinbase | v2 per-account transactions (primary — catches staking rewards, fiat, converts, legacy-Pro remnants) + Advanced Trade fills for fill detail | legacy Coinbase Pro fills may exist only in v2/statements — verified against the real account at onboarding |
| Binance | Statement-export CSVs in date slices for the historical rebuild (the only reliable full-history source, esp. old Earn programs); API thereafter (per-symbol trades via id-iteration, deposits/withdrawals in 90-day windows, Earn rewards in 3-month windows) | AUD activity ends mid-2023 (delisting); old Earn-program rewards may be API-inaccessible — CSV covers them |
| BTC/LTC wallets | Blockbook-style xpub endpoints (whole-wallet derivation server-side); esplora-shape APIs as cross-check | public Trezor instances are dev-only; use a hosted Blockbook (e.g. NOWNodes) |
| ETH wallets | Address history incl. token transfers (Alchemy primary, Etherscan v2 secondary) | Etherscan free tier has shrunk (1,000-record pages); fine at personal scale |
| ETH staking (Everstake pool via Trezor Suite) | Rewards auto-compound inside the pool — invisible in transaction history. Reconstructed by periodic archive-node reads of the pool's balance-of methods for the operator's address, plus claim/unstake transactions | receipt-timing of pooled auto-compounding rewards is an ATO grey area — the receipt-point setting (accrual-snapshot vs claim) is explicit and recorded |
| ADA / DOT / SOL (as configured) | Per-epoch reward endpoints (Blockfrost; Subscan reward history; inflation-reward RPC iteration) — staking rewards on these chains are events, not transactions, and are fetched as such | enabled per configured wallet, not speculatively |
| Manual CSV | The Money-view import machinery, extended with a tax-event mapping step | operator classifies unrecognized columns once; mapping saved |

Every sync records its fetch windows to the **gap ledger** (`tax_sync_windows`): coverage per source is computed, and holes render in the product as holes.

## The canonical event

`@app/contracts/tax` defines `TaxEvent`: source + source ref (idempotency key, unique-indexed), timestamp, kind (`acquire | dispose | transfer-out | transfer-in | income-staking | income-airdrop | income-other | fee | spend | gift-out | gift-in | lost`), asset, amount, counter-asset and amount where applicable, AUD valuation with `priceSource` reference, classification flags (personal-use opt-in, wrap-override, receipt-point), and the raw-payload R2 pointer. Normalizers per connector map source records to events; an unrecognized source record becomes an `unclassified` row in the review queue — normalizers never guess.

## The pipeline

```
sync (per source, incremental, windows → gap ledger)
  → normalize (source records → TaxEvents; unknowns → review queue)
  → transfer-match (same asset, opposite directions, ≤12h window,
     fee tolerance; matched pairs become transfers — not disposals;
     network-fee units become fee-disposal events per ATO guidance)
  → classify (deterministic rules first; ambiguous events → review
     queue, with AI suggestions as validated, operator-confirmed
     assists — never silent decisions)
  → basis engine (pure): parcel pools per asset; FIFO default,
     HIFO/LIFO as specific-identification variants; disposal ledger
     with per-parcel acquisition dates → discount eligibility
  → FY aggregation: losses applied to non-discountable gains first
     (operator-overridable), 50% discount on the remainder, myTax
     figures + other-income total + CGT-schedule flag
  → report generation (Reports library) + running FY estimate
```

Derived stages (parcels, disposals, aggregates) are rebuildable from `tax_events` at any time — the same blotter-derivation philosophy as trading. Contested-rule settings (wrap-as-disposal on by default; transfer-fee-to-cost-base off; staking receipt point; personal-use per-event) live in versioned configuration with the same change discipline as mandates.

## The price service

A local `price_cache` (D1) fronts all valuation: preference order is (1) the price embedded in the source transaction itself (the executing exchange's rate — the ATO-preferred source), (2) direct AUD candles where they exist (Kraken BTC/AUD, ETH/AUD), (3) USD(T) candles (Binance/Kraken klines, full depth, free) × the RBA daily AUD rate — the rate source the ATO itself uses, (4) an aggregator (CoinGecko) for odd assets, noting its free tier only reaches one year back. Every stored valuation records source, granularity, and fetch time; the same event always re-values identically.

## Verification machinery

- **Balance reconciliation** (scheduled): per source, fold `tax_events` to computed holdings; compare against live balances (gateway for exchanges, chain APIs for wallets). Mismatch → `warning` event + a visible per-source error until resolved.
- **Missing basis**: a disposal that overdraws its parcel pool creates a zero-basis parcel *and* a persistent flag; the report lists every zero-basis disposal it contains.
- **The oracle check** (one-time): the prior service's export imported into a comparison table; per-FY and per-asset diffs computed and itemized; each difference resolved (our bug, their bug, or a documented interpretation difference) before the arm is declared the system of record.
- **Determinism test**: the full engine re-run over the event store must reproduce the published report byte-for-byte; this runs in CI and before every report generation.

## D1 additions

`tax_sources`, `tax_sync_windows` (the gap ledger), `tax_events` (append-only, source-ref unique), `tax_review_queue`, `transfer_matches`, `tax_settings_versions`, `price_cache`, and derived/rebuildable `tax_parcels`, `tax_disposals`, `tax_fy_summaries`. Raw payloads: R2 `tax/raw/{source}/{yyyy-mm}/…`; reports join the existing `reports` table and R2 layout.

## Activity feed

New Money-category events: tax source synced (n events, coverage delta); gap detected or closed; missing-basis flag raised or resolved; source balance mismatch; oracle-check difference recorded; FY report generated.
