# The Tax arm

The tax arm replaces the operator's external crypto tax service (Summ, née Crypto Tax Calculator) with an in-house one: it assembles the operator's complete crypto history — Ironcage's own trading plus every external exchange account and self-custody wallet — classifies every event under Australian tax rules, computes cost basis and capital gains, and produces the financial-year report an individual files from. It is an insight arm: it reads everything and trades nothing.

Scope, deliberately: **an Australian individual investor with exchange accounts (spot + staking) and self-custody wallets.** DeFi protocols, NFTs, and derivatives are out of scope until a recorded decision brings them in; the classification engine is built so unrecognized event shapes are *flagged, never guessed*.

## Sources

- **Ironcage's own sleeves** — native and perfect: the blotter already records every fill, fee, and timestamp.
- **Exchange accounts** — full-history sync via read-only API keys (Kraken, Coinbase, Binance, and others as configured), including trades, deposits, withdrawals, and staking/earn rewards. Where an exchange's API cannot reach old history (a real limitation, not a hypothetical), the arm ingests that exchange's statement exports and says exactly which periods came from which source.
- **Wallets** — self-custody addresses tracked on-chain: xpub-based tracking for UTXO coins (the whole wallet from one key, no address lists), address-based tracking for account chains (ETH including tokens, and staking-reward reconstruction where rewards accrue invisibly inside pools), per-chain reward history for staked assets (ADA epochs, DOT payouts, SOL inflation credits) as configured wallets require.
- **Manual import** — CSV for anything else (a dead exchange, a one-off), with the same normalization and the same audit trail.

The operator's historical rebuild is **from raw sources by design**. The prior tax service's export is used exactly once, as a *verification oracle*: imported, compared, differences listed — never as a data source.

## The ledger of events

Every source normalizes into one canonical event record (acquisition, disposal, transfer, income, fee, spend, gift) with its timestamp, amounts, AUD valuation *and the price source that produced it*, plus a link to the raw source record. Transfers between the operator's own accounts and wallets are matched automatically (same asset, opposite directions within a time window, fee-tolerant) and are **not disposals**; the network fee consumed by a transfer **is** a disposal, per ATO guidance. Everything unmatched, unrecognized, or low-confidence lands in a review queue — classification is honest before it is convenient.

## Australian rules, encoded

The engine implements current ATO guidance for individuals, with every contested position an explicit, recorded setting rather than a silent assumption:

- Selling for AUD, **trading crypto for crypto**, spending, and gifting are CGT events at AUD market value.
- **Staking rewards are ordinary income at market value when received**; the received tokens' cost base is that value, and their discount clock starts then. Established-token airdrops likewise; initial-allocation airdrops and chain-split coins enter at zero cost base.
- **Wrapping is a disposal** (the ATO's stated position) — the default, with a recorded override flag, since the industry contests it.
- The **personal-use exemption** is per-transaction opt-in with warnings, never automatic.
- **Parcels and methods**: specific identification with **FIFO as the default**; HIFO/LIFO available as forms of specific identification with a records-adequacy caveat; averaging is not offered.
- The **50% discount** applies to assets held ≥ 12 months, after losses; the engine applies losses to non-discountable gains first (the ATO-sanctioned optimization), operator-overridable.
- **Investor vs trader is surfaced, never decided**: the arm computes on the investor/CGT basis, marks the operator's own high-frequency sleeve activity distinctly, and states the question for the accountant. If trader status is ever adopted, that is a different computation model, not a toggle.

## Verification carries the correctness burden

Because this arm replaces a commercial product outright, it must prove itself continuously rather than be trusted:

- **Balance reconciliation** — for every source, computed holdings vs. the live exchange/chain balance; a mismatch is a visible error, never absorbed.
- **Missing-basis flags** — a disposal exceeding tracked acquisitions is flagged loudly and costed at zero basis *visibly*, the conservative and honest treatment.
- **The gap ledger** — every source shows which periods were fetched from where; holes are displayed, not papered over.
- **The oracle check** — the one-time comparison against the prior service's export, with every difference itemized and resolved or explained.
- **Traceability** — every figure on the final report walks back to canonical events, and every event to its raw source record.

## The report

A financial-year report containing exactly what myTax asks of an individual: total current-year capital gains, net capital gain (after losses and discount), net capital losses carried forward, and the other-income total for staking and kin — plus the flag when gross gains exceed the CGT-schedule threshold. Behind the headline figures: the per-disposal ledger (acquired, disposed, proceeds, cost base, gain/loss, discount eligibility), the income ledger, closing holdings with cost bases, and the carried-forward loss position — the set an accountant actually wants. Reports live in the [Reports library](./05-reports.md); a running FY estimate lives in the [Money view](./04-money.md) year-round, so tax is a number the operator watches, not a April surprise.

The arm prepares figures and evidence; it does not give tax advice, and the operator (or their accountant) files. Records are permanent — the ATO's five-year retention requirement is satisfied trivially by a system that never deletes anything.
