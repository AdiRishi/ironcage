# Tax

Ironcage's tax engine is holistic and in-house: it assembles the operator's complete investment activity — Ironcage's own trading, every external crypto exchange and self-custody wallet, the US brokerage account, and the interest lines in the imported bank data — classifies every event under Australian tax rules, reconciles everything into one ledger, and produces the financial-year figures an individual files from. It replaces the operator's external crypto tax service (Summ, née Crypto Tax Calculator) and extends past it: crypto is one asset class inside the engine, not its boundary. It reads everything and trades nothing.

Scope, deliberately: **an Australian resident individual investor** with crypto (exchanges: spot + staking; self-custody wallets), US-listed stocks and ETFs via Alpaca, and Australian bank accounts. DeFi protocols, NFTs, derivatives, and trader/business-basis accounting are out of scope until a recorded decision brings them in; unrecognized event shapes are _flagged, never guessed_.

## Sources

- **Ironcage's own sleeves** — native and perfect: the blotter already records every fill, fee, and timestamp, on both venues.
- **Crypto exchanges** — full-history sync via read-only API keys (Kraken and others as configured): trades, deposits, withdrawals, staking and earn rewards, and — importantly — fiat legs, since an AUD→USD conversion done on an exchange is itself a tax-relevant event with an actual achieved rate. Where an exchange's API cannot reach old history, the engine ingests statement exports and shows exactly which periods came from which source.
- **Wallets** — self-custody addresses tracked on-chain: xpub-based tracking for UTXO coins, address-based tracking for account chains including tokens, and per-chain staking-reward reconstruction (including rewards that accrue invisibly inside pools).
- **Alpaca** — the account activity stream: fills, dividends _with their US withholding line items_, interest, fees, cash movements, and corporate actions (splits, spinoffs, mergers). The annual US tax form (1042-S) is archived and reconciled against the year's computed withholding totals.
- **Bank data** — interest income identified from the Money view's imported transactions; also the AUD side of funding flows to and from the brokers.
- **Manual import** — CSV for anything else, with the same normalization and audit trail.

The historical rebuild is **from raw sources by design**. The prior tax service's export is used exactly once, as a _verification oracle_: imported, compared, differences itemized — never as a data source.

## The ledger of events

Every source normalizes into one canonical event record (acquisition, disposal, transfer, income, withholding, fee, spend, gift, corporate action) with its timestamp, amounts, **AUD valuation and the rate source that produced it**, plus a link to the raw source record. Transfers between the operator's own accounts and wallets are matched automatically and are not disposals (the network fee consumed by a crypto transfer is, per ATO guidance); funding flows are matched across their AUD bank leg and their broker/exchange arrival. Everything unmatched, unrecognized, or low-confidence lands in a review queue — classification is honest before it is convenient.

## Australian rules, encoded

Contested or elective positions are explicit, recorded settings — never silent assumptions.

**Capital gains (one regime, all asset classes).** Selling for AUD, trading crypto for crypto, spending, and gifting crypto are CGT events at AUD market value; US share and ETF disposals join the same CGT computation — foreign gains are still item-18 gains. Parcels use specific identification with **FIFO as the default** (HIFO/LIFO available as specific-identification variants with a records-adequacy caveat; averaging not offered). The **50% discount** applies to parcels held ≥ 12 months, after losses; losses are applied to non-discountable gains first (the ATO-sanctioned ordering), operator-overridable.

**Crypto income.** Staking rewards are ordinary income at market value when received, with cost base set then and the discount clock starting then. Established-token airdrops likewise; initial-allocation airdrops and chain-split coins enter at zero cost base. Wrapping is a disposal by default (the ATO's stated position) with a recorded override. The personal-use exemption is per-transaction opt-in with warnings.

**Currency is an asset too.** Every USD amount — each fill, dividend, fee — is translated to AUD at the transaction date (RBA daily rate by default; the ATO monthly-average option and actual-achieved rates where a real conversion backs the flow are recorded alternatives). For the USD cash balance itself, the engine supports both Division 775 modes: the **limited balance election** (the default recommendation at this scale — FX movements on the cash balance are disregarded; the engine generates the written election document, monitors the A$250k threshold and its buffer, and alerts on approach) or full forex tracking (currency lots, FIFO, realisation gains and losses as ordinary income) if the election is not made.

**Foreign income.** US dividends are assessable foreign income, grossed up to include the 15% treaty withholding (W-8BEN, whose three-year expiry the engine tracks); withholding feeds the **foreign income tax offset** — claimed directly up to the $1,000 threshold, with the offset-limit calculation above it, and a warning that unused FITO is simply lost. Broker cash interest is foreign income; Australian bank interest is domestic interest — the engine keeps them on their separate return items. ETF capital-gain distributions and returns of capital are classified separately (the latter reducing cost base), each with its recorded default and accountant flag.

**Corporate actions.** Splits adjust parcels with no CGT event; mergers, spinoffs, and kin are CGT events flagged for review with rollover-eligibility noted — never silently processed.

**Investor vs trader is surfaced, never decided.** The engine computes on the investor/CGT basis, marks the operator's own high-frequency sleeve activity distinctly, and states the question for the accountant. Trader status would be a different computation model, not a toggle.

## Verification carries the correctness burden

- **Balance reconciliation** — per source, computed holdings vs. live exchange/chain/broker balances; a mismatch is a visible error, never absorbed.
- **Missing-basis flags** — a disposal exceeding tracked acquisitions is costed at zero basis _visibly_ and flagged loudly.
- **The gap ledger** — every source shows which periods were fetched from where; holes render as holes.
- **Cross-document reconciliation** — the year's computed US withholding reconciles against the broker's 1042-S; exchange-sourced totals reconcile against what the ATO's data-matching program sees.
- **The oracle check** — the one-time comparison against the prior service's export, every difference itemized and resolved or explained.
- **Traceability** — every figure on the report walks back to canonical events, and every event to its raw source record.

## The report

One financial-year report covering the whole picture, shaped exactly as myTax asks: the capital gains item (total current-year gains, net capital gain after losses and discount, losses carried forward, and the CGT-schedule flag), the foreign-income item (assessable foreign income, net foreign income, the FITO claim, and the A$50,000 foreign-assets question answered from computed peak balances), interest and other income where they belong, and — if forex tracking is on — the forex gain/loss lines. Behind the headline figures: the per-disposal ledger with discount eligibility, the income ledger by type and source, the withholding ledger, closing holdings with AUD cost bases, and the carried-forward loss position — the set an accountant actually wants. Reports live in the [Reports library](./05-reports.md); a running FY estimate — gains position, income to date, FITO accrued, election-threshold headroom — lives in the [Money view](./04-money.md) year-round.

The engine prepares figures and evidence; it does not give tax advice, and the operator (or their accountant) files. Records — including rate provenance per transaction, the election document, W-8BEN validity, and the annual 1042-S — are permanent; the ATO's five-year retention requirement is satisfied trivially by a system that never deletes anything.
