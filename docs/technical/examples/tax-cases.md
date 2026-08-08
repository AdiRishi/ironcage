# Worked examples — tax golden cases

Hand-computed scenarios that double as golden-file tests for `packages/tax` ([Tax](../09-tax.md)). Each case lists the canonical events, the expected parcel arithmetic, and the expected FY figures. Every case in this file is a CI golden fixture: the test suite feeds the events in and requires byte-identical agreement with the expected figures stated here.

Conventions, shared with the chapter: amounts are AUD unless marked; intermediate arithmetic is unrounded and each disposal ledger line rounds half-even to the cent; dates are Australia/Sydney local dates; the CGT discount requires the asset to have been acquired at least 12 months before the CGT event, excluding both the acquisition day and the CGT-event day — in date arithmetic, the disposal date must be strictly after the acquisition date plus 12 calendar months. No case uses a day count for the discount test.

## Case 1 — BTC: acquire, transfer with network fee, partial disposal with discount

**This case is a CI golden fixture.**

**Events**

| #   | Date       | Event          | Detail                                                                    |
| --- | ---------- | -------------- | ------------------------------------------------------------------------- |
| 1   | 2024-07-10 | acquisition    | Buy 0.5 BTC @ A$90,000 on Kraken; fee A$117.00 (0.26%)                    |
| 2   | 2024-08-01 | transfer + fee | Move 0.5 BTC Kraken → cold wallet; network fee 0.0002 BTC; BTC @ A$95,000 |
| 3   | 2025-08-20 | disposal       | Sell 0.2 BTC @ A$117,000 from the wallet; fee A$60.84                     |

Event 3 is a direct sale from the wallet. A sale routed back through Kraken would first add a transfer and another network-fee disposal; it is omitted so the arithmetic stays legible.

**Expected computation**

- Event 1 creates parcel P1: 0.5 BTC, acquired 2024-07-10, cost base 45,000.00 + 117.00 = **45,117.00** (acquisition fee into cost base), location `kraken`.
- Event 2: the transfer itself is not a disposal; P1 moves to location `wallet` with date and cost base intact. The **network fee is a disposal** of 0.0002 BTC: proceeds 0.0002 × 95,000 = 19.00; cost base consumed 45,117.00 × 0.0002/0.5 = 18.05; **gain 0.95**. Acquired 2024-07-10, disposed 2024-08-01 — far short of 12 months → no discount. P1 becomes 0.4998 BTC, cost base 45,098.95.
- Event 3: FIFO within location `wallet` selects P1. Proceeds 0.2 × 117,000 − 60.84 = 23,339.16 (disposal fee reduces proceeds). Cost base consumed 45,098.95 × 0.2/0.4998 = 18,046.80. Gain 5,292.36. Discount test: 2024-07-10 + 12 months = 2025-07-10, and the disposal date 2025-08-20 is strictly after it → **discountable**.

**Expected FY figures**

- **FY2024–25** holds the network-fee disposal alone: current-year gain 0.95, not discountable; net capital gain **0.95**.
- **FY2025–26** holds the sale: current-year gain 5,292.36; no losses; discount applies → net capital gain **2,646.18**. Closing holdings: 0.2998 BTC, cost base 27,052.15, location `wallet`.

## Case 2 — US dividend with actual withholding and FITO

**This case is a CI golden fixture.**

**Events**

| #   | Date       | Event       | Detail                                                        |
| --- | ---------- | ----------- | ------------------------------------------------------------- |
| 1   | 2026-03-25 | income      | VTI dividend: 100 shares × USD 0.95 = USD 95.00               |
| 2   | 2026-03-25 | withholding | Broker withholding activity line: USD 14.25 actually withheld |

The withholding amount is read from the broker's activity line, never computed from a rate. USD 14.25 happens to equal 15% of the gross, consistent with a valid W-8BEN, but the engine records the line's amount as-is. Which activity code carries this line (`DIVNRA` or `DIVTW`) is a **VERIFY** item in [Tax](../09-tax.md) §5; the fixture attaches the withholding to the dividend by symbol and pay date, which is code-independent.

**Expected computation** — AUDUSD RBA daily rate for 2026-03-25 taken as 0.6550 USD per AUD (illustrative, not a default):

- Gross dividend in AUD: 95.00 / 0.6550 = **145.04**, rate source `rba-daily`.
- Withholding in AUD: 14.25 / 0.6550 = **21.76**.
- Net cash in AUD: 80.75 / 0.6550 = **123.28** (checks: 145.04 − 21.76 = 123.28).
- Assessable foreign income includes the gross 145.04 (the withheld amount is income too); FITO accrues 21.76.

**Expected FY figures** (alone): assessable foreign income 145.04; FITO claim 21.76 — under the A$1,000 threshold → claimed directly, no offset-limit calculation, no tax-profile dependency. Raw US withholding is USD 14.25. In its recipient/income-code/rate group, the 1042-S comparison expects the form's whole-dollar USD amount under IRS rounding; AUD translation remains separate.

**Variant** — if the year's total FITO exceeded A$1,000, the offset-limit calculation engages and requires the operator's tax profile. The expected behavior is a figure computed from the profile's rate table plus a report annotation naming the profile version used. Without a profile, the expected behavior is the restricted A$1,000 direct claim, stated as such on the report.

## Case 3 — discount boundary at exactly 12 months

**This case is a CI golden fixture.** It pins the both-end-days-excluded boundary: a sale on the 12-month anniversary misses the discount; a sale the day after qualifies.

**Events**

| #   | Date       | Event       | Detail                                               |
| --- | ---------- | ----------- | ---------------------------------------------------- |
| 1   | 2024-09-16 | acquisition | Buy 100 units of an ETF @ A$50.00; brokerage A$10.00 |
| 2   | 2025-09-16 | disposal    | Sell 40 units @ A$60.00; brokerage A$8.00            |
| 3   | 2025-09-17 | disposal    | Sell 40 units @ A$61.00; brokerage A$8.00            |

**Expected computation**

- Event 1 creates parcel P1: 100 units, acquired 2024-09-16, cost base 5,000.00 + 10.00 = **5,010.00** (A$50.10 per unit).
- Event 2: proceeds 40 × 60.00 − 8.00 = 2,392.00. Cost base consumed 5,010.00 × 40/100 = 2,004.00. Gain **388.00**. Discount test: 2024-09-16 + 12 months = 2025-09-16; the disposal date is not strictly after it → **not discountable**. Excluding both end days, the counted period runs 2024-09-17 through 2025-09-15, one day short of 12 months.
- Event 3: proceeds 40 × 61.00 − 8.00 = 2,432.00. Cost base consumed 2,004.00. Gain **428.00**. Discount test: 2025-09-17 is strictly after 2025-09-16 → **discountable**. Excluding both end days, the counted period runs 2024-09-17 through 2025-09-16, exactly 12 months.

**Expected FY2025–26 figures** (alone): current-year gains 388.00 non-discountable + 428.00 discountable; no losses; net capital gain 388.00 + 428.00 × 0.50 = **602.00**. Closing holdings: 20 units, cost base 1,002.00.

An implementation that tests "held ≥ 365 days" grants event 2 the discount and fails this fixture. No fixed day count reproduces the month rule: the span from acquisition to the 12-month anniversary is 365 or 366 days depending on whether a 29 February falls inside it, so the computation must use calendar-month arithmetic.

## Case 4 — loss ordering across discountable and non-discountable gains, with carried-loss vintages

**This case is a CI golden fixture.** It pins three rules at once: current-year losses apply before carried losses; carried vintages apply in origin order and are reported separately; and the direction of application is the taxpayer's choice, with non-discountable-first as the recorded default.

**Opening inputs** (operator-supplied, evidenced by prior returns):

| Carried-loss vintage | Amount   |
| -------------------- | -------- |
| FY2023–24            | A$500.00 |
| FY2024–25            | A$400.00 |

**Events** (fees omitted throughout so the arithmetic stays legible):

| #   | Date       | Event       | Detail                             |
| --- | ---------- | ----------- | ---------------------------------- |
| 1   | 2024-05-02 | acquisition | Buy 1.0 ETH @ A$4,000              |
| 2   | 2025-08-15 | acquisition | Buy 10,000 XYZ @ A$0.30 (A$3,000)  |
| 3   | 2025-11-03 | acquisition | Buy 20 SOL @ A$250 (A$5,000)       |
| 4   | 2026-02-10 | disposal    | Sell 1.0 ETH @ A$7,000             |
| 5   | 2026-03-05 | disposal    | Sell 10,000 XYZ @ A$0.21 (A$2,100) |
| 6   | 2026-04-01 | disposal    | Sell 20 SOL @ A$310 (A$6,200)      |

**Expected per-disposal results** (all in FY2025–26):

- ETH: gain 7,000 − 4,000 = **3,000.00**; acquired 2024-05-02 + 12 months = 2025-05-02, disposal 2026-02-10 is strictly after it → discountable.
- XYZ: 2,100 − 3,000 = **loss 900.00** (current-year; discount eligibility is irrelevant to losses).
- SOL: gain 6,200 − 5,000 = **1,200.00**; acquired 2025-11-03, disposed 2026-04-01, under 12 months → non-discountable.

**Expected loss application** (default direction: non-discountable gains first):

| Step | Pool                       | Applied to      | Amount          | Remaining gains after step |
| ---- | -------------------------- | --------------- | --------------- | -------------------------- |
| 1    | current-year loss (900.00) | SOL (non-disc.) | 900.00          | SOL 300.00 · ETH 3,000.00  |
| 2    | FY2023–24 vintage (500.00) | SOL, then ETH   | 300.00 + 200.00 | SOL 0.00 · ETH 2,800.00    |
| 3    | FY2024–25 vintage (400.00) | ETH             | 400.00          | ETH 2,400.00               |

Discount on the remainder: 2,400.00 × 0.50 = **1,200.00**. Net capital gain **1,200.00**. Carry-forward: FY2023–24 vintage 0.00, FY2024–25 vintage 0.00, current-year 0.00 — each reported per vintage, never lumped.

**Expected alternative-ordering scenario** (recorded operator override: discountable gains first): all 1,800.00 of losses go to ETH → ETH 1,200.00 → discounted 600.00; SOL 1,200.00 stands → net capital gain **1,800.00**. The fixture asserts both results, and that the default direction produces the smaller net gain (a difference of 600.00). The ordering is the taxpayer's choice; the default is a recorded optimization, and an override must appear in the run's recorded acts.

## Case 5 — lapsed W-8BEN: 30% withholding actually applied

**This case is a CI golden fixture.** It pins the rule that withholding is always the amount actually withheld, and the engine's behavior when the form behind the treaty rate has expired.

**Setup**: the operator's W-8BEN was signed 2022-06-15. It remains valid through the end of the third succeeding calendar year: 2025-12-31. The expiry warning fires 90 days before, on 2025-10-02 (proposed default). No new form is filed.

**Events**

| #   | Date       | Event       | Detail                                                        |
| --- | ---------- | ----------- | ------------------------------------------------------------- |
| 1   | 2026-03-25 | income      | Dividend: 200 shares × USD 0.80 = USD 160.00                  |
| 2   | 2026-03-25 | withholding | Broker withholding activity line: USD 48.00 actually withheld |

USD 48.00 is 30% of the gross — the non-treaty rate the broker applies once the form lapses. The engine records 48.00 because the line says 48.00, not because it computed 30%; the same fixture with a 15% line would simply record 24.00.

**Expected computation** — AUDUSD RBA daily rate for 2026-03-25 taken as 0.6400 USD per AUD (illustrative, not a default):

- Gross dividend in AUD: 160.00 / 0.6400 = **250.00**.
- Withholding in AUD: 48.00 / 0.6400 = **75.00**.
- Net cash in AUD: 112.00 / 0.6400 = **175.00** (checks: 250.00 − 75.00 = 175.00).
- Treaty-limited portion: 15% of USD 160.00 = USD 24.00 → **37.50** AUD. Excess over the treaty rate: USD 24.00 → **37.50** AUD.

**Expected FY2025–26 figures and findings** (alone): assessable foreign income 250.00. FITO accrues **37.50**, the treaty-limited portion, under the recorded default; the 37.50 excess is not claimed and appears as an accountant-review item (the expected recovery path is a refund claim to the IRS, an operator action outside the engine — see [Tax](../09-tax.md) open question 4). The run carries two attention items: the W-8BEN lapsed on 2025-12-31 with the warning history showing the 2025-10-02 alert, and the withholding on this dividend exceeds the treaty rate. The 1042-S cross-check for the 2026 US calendar year expects USD 48.00 for this line.
