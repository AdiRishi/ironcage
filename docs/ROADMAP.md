# Ironcage — Roadmap

The build order, decided and recorded in the [decision history](./technical/appendix/decisions.md): **Money first, Tax second, the investing engine third.** No dates — phases end when their exit criteria hold, and the phases exist because of two facts about this system: the read-only surfaces are useful immediately at zero risk, and the platform spine they require is the same spine the engine will later stand on. Building in this order means every piece of shared infrastructure is proven on money-that-only-gets-read before it touches money-that-moves.

## Phase 1 — Wealth management (Money)

Bank import, categorization, spending analysis, and the first reports — the [Money](./product/05-money.md) surface end to end.

What it delivers: CSV/OFX import with the three-tier dedupe, the categorization capability with its review queue and rules, monthly/trends/recurring/anomaly analysis, savings suggestions, the monthly spending report, and external balances feeding a first whole-of-wealth view.

**What phase 1 quietly builds — the real payload:**

- The monorepo, the four-Worker skeleton (compute can stay empty), local dev, deploys, migrations.
- `wealth.arishi.dev` behind Cloudflare Access — the decided auth model ([decision history](./technical/appendix/decisions.md)).
- Postgres via dual Hyperdrive, the schema conventions, R2 layout.
- The app shell (mode, connection indicator, attention items), TanStack Query + feed plumbing.
- The feed itself: events, severities, acknowledgment — exercised by imports and anomalies before anything critical exists.
- **The entire AI runtime on its first real capability**: the categorization agent in Flue, gateway-fronted providers, the decision-records queue, gateway traces, safe defaults, the review queue. Every seam the regime assessment will later cross gets crossed first by transaction categorization, where the worst possible failure is a miscategorized coffee.
- The reports library with its first report type.

Exit criteria: a full year of real CommBank history imported with dedupe verified by balance-chain; categorization running with rules learning from corrections; the first monthly report generated; the operator checking the app because it's useful, not because it's new. The fixture homework lands here too: real overlapping NetBank exports (deposit and card, including a multi-row day) are what clear the OFX `FITID` and export-format **VERIFY** markers in the technical chapters.

## Phase 2 — Tax

The [tax engine](./product/09-tax.md): source sync workflows (Kraken full-history export, external exchanges, wallets, Alpaca activities, bank interest from phase 1's data), the canonical event ledger, `packages/tax` computation (parcels, CGT, Division 775, FITO), the verification layer, the FY report, and the running estimate on Portfolio.

Why second: it completes the read-only half while the engine is still unbuilt, replaces the paid external service (the one-time oracle comparison happens here), and its source-sync machinery — long-running workflows, gap ledgers, reconciliation against external systems — is a dress rehearsal for venue reconciliation. It also makes phase 3 accountable from birth: when the first sleeve trades, its tax events land in an engine that already works.

Exit criteria: full history reconciled from raw sources across every account and wallet; balance reconciliation green on every source; differences against the prior service's export itemized and each one explained; a FY report an accountant would accept. The fixture homework lands here too: a full Kraken history export and a real Alpaca activities pull are what clear the venue-export and activity-code **VERIFY** markers in the technical chapters.

## Phase 3 — The investing engine

Everything else, in lifecycle order:

1. **Candle store and workbench basics** — collection, backfill from Kraken archives, coverage honesty, first backtests of the crypto-trend strategy in the compute container.
2. **The actors and the cage** — sleeve, venue, system-cage, feed actors; the tick; the intent ledger; venue adapters proven against Alpaca's paper environment and Kraken's validate-only orders ([Operations](./technical/12-operations.md)).
3. **Crypto-trend in dry run** — the first tenant, with its capabilities (regime assessment, event veto, calibration audit) accruing scorecards against their no-AI baselines from day one, and the living view making it worth watching.
4. **Trial, promotion, live** — the trial report, the ceremony, first small real capital on Kraken; the long-term wealth sleeve arrives with the Alpaca integration and its own dry run.
5. **The proving machinery matures** — gate pipeline, proposals, shadow runs — once there is an incumbent worth challenging.

A clarification recorded in the [decision history](./technical/appendix/decisions.md) because it's easy to misremember: **dry run is our own simulated-fill machinery against live market data, not a venue paper account.** Kraken offers no spot sandbox at all, and one simulator serving dry run, backtests, and the no-AI counterfactuals is what makes their evidence comparable. Alpaca's paper account is provisioned anyway — it integration-tests the venue adapter, nothing more.

## The dependency map

What actually depends on what — and therefore what could proceed in parallel if the operator's appetite says so:

| Work                                                     | Depends on                               | Independent of               |
| -------------------------------------------------------- | ---------------------------------------- | ---------------------------- |
| Platform spine (workers, DB, auth, shell, feed, reports) | —                                        | everything below             |
| Money                                                    | spine                                    | tax computation, engine      |
| Tax sources & ledger                                     | spine; bank data (one source among many) | engine (until sleeves trade) |
| Candle store / workbench                                 | spine                                    | Money, tax                   |
| Actors, cage, dry run                                    | spine, candle store                      | Money, tax                   |
| Gate pipeline / proposals                                | workbench, a running sleeve              | Money, tax                   |

The phases serialize the spine's construction through the lowest-risk consumer first; after phase 1, the islands are genuinely parallel and the order between tax and engine work is preference, not dependency — the decided preference is tax first.
