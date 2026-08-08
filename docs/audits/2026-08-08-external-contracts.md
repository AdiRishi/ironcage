# External contract audit

**Audit date:** 2026-08-08

**Scope:** all 4,949 lines under `docs/`, the pinned dependency catalog, and the vendored Effect source
**Evidence rule:** an external claim is accepted only when supported by a current primary source. Absence from official documentation is recorded as **unverified**, not inferred to be true or false.

## Remediation status

The product and technical specifications were corrected from this audit on 2026-08-08. The detailed findings below preserve the pre-remediation claims, locations, sources, and reasoning; line numbers may have moved and “Repository claims” describes the audited snapshot, not the corrected text.

The documentation remediation is complete across venue execution/data/reconciliation, tax, CommBank, Cloudflare contracts, Flue/Gateway persistence, database recovery, compute authority, and product promises. The deployment decision is also closed: Ironcage uses one `main`-branch, `wrangler deploy`-based whole-repository release behind a temporary entry block, with no staged percentages, pinpoint production deploys, or operator-selected per-Worker rollout.

This does **not** convert account-specific or undocumented behavior into fact. The mandatory conformance/written-confirmation gates near the end remain open launch conditions. Where no provider has been selected—email, external dead-man, some tax data sources—the corrected specification keeps the dependent feature unavailable rather than inventing a contract.

## Executive conclusion

At the audited snapshot, the documentation was unusually disciplined about uncertainty but was not contract-clean. Several load-bearing assumptions were contradicted by official documentation and would have prevented deployment, weakened a safety guarantee, lost accounting fidelity, or calculated tax incorrectly.

The corrected chapters may now guide implementation, but only inside their explicit launch gates. The pre-remediation venue, Division 775, and 1042-S contracts described in the findings below must not be resurrected.

The most important snapshot failures were:

1. Kraken order expiry omits the `GTD` time-in-force required for `expiretm`, so the promised venue-side expiry can silently remain GTC.
2. Both venue ambiguity branches assume undocumented visibility/idempotency guarantees. A negative lookup is not proof of non-placement, and Alpaca does not document same-ID retries as idempotent.
3. Alpaca order polling does not expose immutable executions, so it cannot be the fill ledger described in the spec.
4. Cloudflare Access service tokens are authorized with the wrong JWT claim.
5. The Division 775 limited-balance algorithm omits statutory translation and buffer rules, and eligibility of a brokerage USD cash ledger is unproven.
6. Flue durably stores conversations and submissions in Durable Object SQLite, contradicting the Gateway-only, temporary-retention story.
7. The current Durable Object deployment plan is incompatible with Cloudflare's recommended new-project `exports` configuration.
8. The planned Cloudflare infrastructure-cost API cannot return populated cost fields today.
9. The compute container has neither the bindings nor an acceptable trust boundary for the R2/Postgres work assigned to it.
10. Product claims around CommBank formats/history, Australian Alpaca availability, Alpaca crypto disablement, and one annual 1042-S are stronger than the providers' contracts.

This was never a conclusion that the system was infeasible. The applied fixes preserve the architecture: adapters are explicit, unsafe venue outcomes quarantine, tax state machines match primary authority, untrusted compute cannot write the record, and account-specific behavior is a conformance gate.

## Method and confidence

The audit used:

- exact claim locations in the repository;
- official provider/API/framework documentation, official statutes and tax-agency guidance, and the vendored source pinned by this repository;
- no community posts, generated summaries, or undocumented behavior as authority;
- an explicit distinction between an advertised platform contract and proof that the operator's actual account, plan, entitlement, fixture, or deployed version exhibits it.

The repository currently contains documentation and tooling, but no application packages (`pnpm-workspace.yaml` has an empty package list). Therefore this audit can validate the plan against advertised contracts; it cannot validate implementation behavior. Account-specific and race-sensitive claims remain release gates even when the API shape is documented.

### Verdicts

- **Contradicted:** the primary source says something incompatible with the spec.
- **Partial:** the mechanism exists, but a precondition, limit, unit, lifecycle, or failure mode is missing.
- **Unverified:** the provider does not publish the relied-upon guarantee, or it depends on the operator's actual account/plan.
- **Verified (advertised):** current official documentation supports the statement; implementation fixtures are still required at risky seams.

### Priorities

- **P0:** safety, financial correctness, authorization, or live-trading blocker.
- **P1:** implementation, privacy, recoverability, or material product-contract blocker.
- **P2:** important runbook, cost, limit, or wording correction.
- **P3:** verified foundation or lower-risk volatility to keep in the assumption register.

## P0 — correct before implementing the affected subsystem

### EC-01 — Kraken venue expiry is not configured

- **Repository claims:** `docs/technical/06-venues.md:44-50,168,251,283` says `expiretm` mirrors the fill window and guarantees that a dead engine leaves no immortal order.
- **Verdict:** **Contradicted.** Kraken applies `expiretm` only when `timeinforce=GTD`; the default time-in-force is GTC. Kraken also constrains expiry to at least 5 seconds and no more than one month.
- **Primary source:** [Kraken Add Order](https://docs.kraken.com/api-reference/trading/add-order).
- **Impact:** the order can remain live after the intended 30-minute window while the engine is unavailable.
- **Required change:** map `timeinforce=GTD` whenever `expiretm` is present; validate Kraken's time bounds; persist both values. Gate live trading on a fixture that partially fills an order, lets it expire, then verifies the canceled remainder and `vol_exec`.

### EC-02 — Kraken lookup-after-deadline does not prove non-placement

- **Repository claims:** `docs/technical/06-venues.md:47,103,128-156,286` concludes `failed`, releases the reservation, and permits a new intent when Open and Closed Orders do not show the ID after `deadline`.
- **Verdict:** **Unverified and unsafe.** `deadline` bounds how late the matching engine accepts the request. Kraken publishes no read-after-write or visibility SLA connecting that deadline to Open/Closed Orders.
- **Primary sources:** [Add Order](https://docs.kraken.com/api-reference/trading/add-order), [Open Orders](https://docs.kraken.com/api-reference/account-data/get-open-orders), [Closed Orders](https://docs.kraken.com/api-reference/account-data/get-closed-orders).
- **Impact:** an accepted order that is not yet visible can be treated as absent; releasing its reservation and creating a new ID can duplicate exposure.
- **Required change:** query Open and Closed repeatedly across a bounded reconciliation interval and cross-check Trades/Ledger. If still unprovable, quarantine. Automatic failure requires a written Kraken consistency guarantee. Also validate that `request timeout + 5s` stays inside Kraken's 2–60 second `deadline` bounds.

### EC-03 — Alpaca same-ID resubmission is not a documented idempotency contract

- **Repository claims:** `docs/technical/06-venues.md:28,78,103-104,128-156,266-277` treats lookup miss followed by same-`client_order_id` submission as the safe ambiguity path and says both venues enforce active/open-only uniqueness with terminal reuse.
- **Verdict:** **Unverified; categorical uniqueness/reuse wording is unsupported.** Alpaca documents a unique client ID and lookup by that ID, but not active-only scope, reuse after terminal states, same-ID retry behavior, atomic deduplication, or lookup visibility.
- **Primary sources:** [Alpaca Create Order](https://docs.alpaca.markets/us/reference/postorder), [Get order by client order ID](https://docs.alpaca.markets/us/reference/getorderbyclientorderid). Kraken documents only open-order uniqueness for its ID: [Kraken client order IDs](https://docs.kraken.com/api/blog/cl-ord-id/).
- **Impact:** a retry following a lookup race can place a second live order.
- **Required change:** a lookup miss must quarantine rather than resubmit. Never deliberately reuse an intent ID. Require written Alpaca confirmation and live tests for accepted/filled/canceled/expired/rejected states before changing that posture. Paper behavior is necessary evidence but not proof of live matching semantics.

### EC-04 — Alpaca status polling cannot produce the promised fill ledger

- **Repository claims:** `docs/technical/06-venues.md:160-170,287` ingests “each response's fills” with immutable venue fill IDs while polling order status.
- **Verdict:** **Contradicted.** Alpaca's Order object exposes aggregate `filled_qty` and `filled_avg_price`, not an execution list with immutable IDs. Immutable execution identity lives in Account Activities or Activity SSE.
- **Primary sources:** [Alpaca Account Activities](https://docs.alpaca.markets/us/docs/account-activities), [Alpaca Activity SSE](https://docs.alpaca.markets/us/docs/activity-sse).
- **Impact:** partial executions, their individual prices, corrections, and busts cannot be reconstructed faithfully from the stated seam.
- **Required change:** use order polling only for lifecycle state. Ingest executions from legacy Activities REST and the new Activity SSE into `(intent_id, venue_fill_id)`, and process correction/bust linkage explicitly.

### EC-05 — Cloudflare Access service-token authorization uses the wrong claim

- **Repository claims:** `docs/technical/04-contracts.md:37,199`, `docs/technical/11-app.md:247,270`, and decision D27 authorize a service token with an audience allowlist.
- **Verdict:** **Contradicted.** `aud` identifies the Access application. The service-token client ID is `common_name` in the application JWT.
- **Primary source:** [Cloudflare Access application-token fields](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/).
- **Impact:** all service tokens admitted to one application share its `aud`; an audience allowlist cannot distinguish callers, while an allowlist populated with service-token IDs rejects all calls.
- **Required change:** validate signature, issuer, expiry, and expected application `aud`, then authorize machine callers by exact `common_name`/service-token Client ID. Keep the Access policy's token selection as defense in depth.

### EC-06 — Division 775 limited-balance computation is materially wrong

- **Repository claims:** `docs/technical/09-tax.md:313-325,406-407,438` and `docs/product/09-tax.md:30` use daily AUD-translated peaks, flag the first A$250k breach, omit the statutory buffers, and leave the legal consequence open.
- **Verdict:** **Contradicted.** The limited-balance test separately aggregates credit and debit balances, translates them using the average exchange rate for the third month before the income year, and permits up to two increased-balance periods per year when each is at most 15 days and the balance never exceeds A$500k. Failure stops the exemption for the failed period; it does not automatically terminate the election.
- **Primary sources:** [ATO forex elections and limited-balance test](https://www.ato.gov.au/forex12mthrule), [Income Tax Assessment Act 1997, Division 775](https://www.legislation.gov.au/C2004A05138/2024-09-15/2024-09-15/text/original/epub/OEBPS/document_9/document_9.html).
- **Impact:** ordinary-income forex gains/losses and alerts can be wrong.
- **Required change:** implement the section 775-245 state machine: separate credit/debit aggregates, statutory translation rate, two ≤15-day windows, A$500k hard ceiling, and cross-year handling. Replace open question 3 with the sourced rule and compute disregarded events only while the test passes.

### EC-07 — eligibility of the broker USD ledger for the election is unproven

- **Repository claims:** the same Division 775 sections assume Alpaca/broker USD cash is a qualifying forex account and call the election the default recommendation.
- **Verdict:** **Unverified.** A qualifying account must be foreign-currency denominated and either a credit-card account or held primarily to facilitate transactions. The repository contains no eligibility analysis for the actual brokerage cash ledger.
- **Primary source:** [ATO forex elections](https://www.ato.gov.au/forex12mthrule).
- **Impact:** the system may disregard taxable forex events for an ineligible ledger.
- **Required change:** default that account to full forex tracking until the actual account agreement and accountant/legal analysis establish eligibility. Archive that evidence and remove the unsupported product recommendation.

### EC-08 — Division 775 is not an account-wide “ignore FX” switch

- **Repository claims:** `docs/technical/09-tax.md:313` and `docs/product/09-tax.md:30` broadly say FX movements are disregarded under the election.
- **Verdict:** **Partial.** While the test passes, the election disregards specified FRE2/FRE4 and attributable CGT effects. FRE1 on depositing foreign currency is not affected.
- **Primary source:** [ATO forex elections](https://www.ato.gov.au/forex12mthrule).
- **Impact:** an account-wide mode can omit taxable events.
- **Required change:** express the election as event-level tax rules, not a balance-wide on/off flag.

### EC-09 — Durable Object feed replay can interleave with live pushes

- **Repository claims:** `docs/technical/11-app.md:163,297` relies on the object's inbox to prevent a live event overtaking replay while replay awaits Postgres.
- **Verdict:** **Contradicted.** Durable Objects are single-threaded, but request handlers can interleave across `await`; `blockConcurrencyWhile` is a bounded exclusion mechanism with a 30-second limit, not a wrapper for a potentially long database replay.
- **Primary sources:** [Durable Object `blockConcurrencyWhile`](https://developers.cloudflare.com/durable-objects/api/state/#blockconcurrencywhile), [rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/).
- **Impact:** the client can see an event before replay/`Ready`, or miss ordering guarantees during reconnect.
- **Required change:** synchronously mark the socket replaying, capture a database high-water mark, replay `(cursor, high_water]`, buffer later live events per socket, flush sorted/deduped, then emit `Ready`.

### EC-10 — “the venue actor serializes all private calls” is too strong

- **Repository claims:** `docs/technical/01-architecture.md:43,104` and `docs/technical/06-venues.md:18` use Durable Object single-threading as structural serialization.
- **Verdict:** **Partial.** External HTTP awaits can interleave. Persist-before-use protects nonce uniqueness, but does not by itself serialize HTTP calls or a rate counter.
- **Primary sources:** the same Durable Object concurrency sources as EC-09.
- **Impact:** concurrent private calls can violate the intended rate/ordering envelope even while nonces remain distinct.
- **Required change:** specify a durable dispatch queue and one persisted in-flight drainer. Keep cage read/check/write within one storage transaction with no external await.

### EC-11 — Alpaca “crypto disabled means no exfiltration” is not a published control

- **Repository claims:** `docs/technical/06-venues.md:70-74,284`, `docs/technical/12-operations.md:36,48,99`, `docs/PRODUCT.md:52`, and `docs/product/04-portfolio.md:25` say a one-time account setting removes wallet/whitelist/transfer routes and therefore a stolen key cannot exfiltrate funds.
- **Verdict:** **Unverified and overstated.** Alpaca's public account-configuration API exposes no such setting. Wallet eligibility depends on jurisdiction and a crypto account/agreement; eligible users have whitelist and transfer APIs.
- **Primary sources:** [Alpaca account configuration](https://docs.alpaca.markets/us/reference/patchaccountconfig-1), [wallet eligibility](https://alpaca.markets/support/what-enables-a-user-to-be-qualified-to-use-crypto-wallets), [wallet FAQ](https://alpaca.markets/support/crypto-wallet-faq), [2026 wallet API changelog](https://docs.alpaca.markets/us/changelog/2026-05-28-chain-79031d0).
- **Impact:** a leaked broad API key may retain a funds-transfer path despite the written guarantee.
- **Required change:** retract the guarantee until production credentials have negative-tested wallet enumeration, whitelist creation, and transfer creation and Alpaca confirms the control in writing. Avoid activating crypto/agreement, assert any observable `crypto_status`, and reconsider the direct-key architecture if no enforceable restriction exists.

### EC-12 — overlapping venue stops are not a proven safety mechanism

- **Repository claims:** `docs/technical/06-venues.md:10,174-182,278` promises every covered position has a venue-resident stop and treats successor-first overlap as benign on insufficient balance.
- **Verdict:** **Unverified.** No official venue contract establishes that redundant sell stops are accepted or that a simultaneous double trigger fails in the claimed way. Alpaca's fractional stop eligibility is also inconsistent across its schema and guide.
- **Primary sources:** [Alpaca user protection](https://docs.alpaca.markets/us/docs/user-protection), [Create Order](https://docs.alpaca.markets/us/reference/postorder), [fractional trading](https://docs.alpaca.markets/us/docs/fractional-trading).
- **Impact:** replacement may be rejected, reserve inventory unexpectedly, or double-execute differently from the design.
- **Required change:** make stop replacement venue/product-specific. Default unproven products to quarantine or cancel-then-place within the grace interval. Require paper plus low-value live tests for overlap, partial fills, simultaneous triggers, reserved quantity, and fractional stops before promising coverage.

## P1 — material implementation and product-contract corrections

### EC-13 — new Durable Object Workers cannot use the documented upload/promote path

- **Repository claims:** `docs/technical/12-operations.md:117,126-137,261,306-307,330` uses `wrangler versions upload` followed by promotion for core, compute, and agents.
- **Verdict:** **Contradicted/highly volatile.** Current guidance for new Durable Objects uses declarative `exports`, and Cloudflare says `wrangler versions upload` fails when `exports` entries exist. Declarative `exports` and legacy migrations are mutually exclusive.
- **Primary sources:** [Durable Object migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/), [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/).
- **Impact:** the deployment runbook fails for every new DO-bearing Worker.
- **Required change:** choose explicitly: use current `exports` plus `wrangler deploy`, or deliberately retain legacy migrations to preserve separate upload/promotion. Extend rollback checks beyond DO classes to deleted/changed KV, D1, R2, and Queue dependencies: [rollback restrictions](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

### EC-14 — uploaded versions do not apply routes or Cron triggers

- **Repository claims:** the eight-step runbook at `docs/technical/12-operations.md:121-132` treats version upload/promotion as the whole deployment.
- **Verdict:** **Incomplete.** Cloudflare provides a separate, experimental trigger deployment command for routes/domains/Cron after version upload, and Cron changes can take up to 15 minutes to propagate.
- **Primary sources:** [Wrangler Workers commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/), [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
- **Impact:** watchdog, vitals, and cost jobs can remain absent or stale after a successful code promotion.
- **Required change:** add trigger deploy plus verification when retaining versions upload, or use `wrangler deploy`; design verification around the propagation interval.

### EC-15 — compute's assigned R2/Postgres authority is absent and unsafe

- **Repository claims:** `docs/technical/10-workbench.md:143-155,175-178` assigns the container R2 artifact reads/writes and a Postgres summary write, while `docs/technical/12-operations.md:44-45` gives compute only an image and backup DSN.
- **Verdict:** **Contradicted as wired.** Containers access Workers bindings through configured outbound handlers. The binding matrix supplies neither normal R2 nor database authority. Supplying untrusted proposal code with a database credential would also breach the stated trust boundary.
- **Primary sources:** [Containers and Workers connections](https://developers.cloudflare.com/containers/platform-details/workers-connections/), [container outbound traffic controls](https://developers.cloudflare.com/containers/platform-details/outbound-traffic/).
- **Impact:** backtests cannot execute the documented receipt protocol safely.
- **Required change:** let the untrusted container return content-addressed R2 artifacts only through narrow outbound handlers with internet disabled. Trusted core verifies hashes and commits the summary atomically. Put `pg_dump`/`DUMP_DSN` in a separate trusted container profile.

### EC-16 — Flue persistence contradicts the temporary-transcript contract

- **Repository claims:** `docs/technical/07-ai.md:117,228,270`, `docs/technical/03-data.md:294`, and `docs/product/03-activity.md:60` say prompts/transcripts live only in Gateway/platform observability and expire.
- **Verdict:** **Contradicted.** On Cloudflare, Flue stores one append-only canonical conversation stream per agent instance in Durable Object SQLite. Accepted submissions and durable state are persisted; settled submission and dispatch-receipt rows are documented as retained indefinitely.
- **Primary sources:** [Flue deployment on Cloudflare](https://flueframework.com/docs/ecosystem/deploy/cloudflare/), [durable execution](https://flueframework.com/docs/concepts/durable-execution/), [routing API](https://flueframework.com/docs/api/routing-api/), [events reference](https://flueframework.com/docs/api/events-reference/).
- **Impact:** the data inventory, privacy description, deletion/retention policy, access controls, and backup model are wrong; sensitive prompt/tool data can outlive AI Gateway logs.
- **Required change:** inventory persisted fields separately for agents and workflows; define retention, deletion, export, and access policies; acknowledge DO SQLite as durable non-Postgres record. If runtime capability runs must not retain transcript-like state, prove a non-conversational path and sanitize durable events.

### EC-17 — AI Gateway trace retention is count-based, not 7–30 days

- **Repository claims:** `docs/product/03-activity.md:60`, `docs/technical/07-ai.md:117,244,270`, and `docs/technical/03-data.md:294` promise a 7–30 day trace window.
- **Verdict:** **Contradicted.** Logs are constrained by plan/count and per-gateway storage settings. At the limit, new logs stop unless oldest-log deletion is enabled.
- **Primary sources:** [AI Gateway logging](https://developers.cloudflare.com/ai-gateway/observability/logging/), [AI Gateway limits](https://developers.cloudflare.com/ai-gateway/reference/limits/).
- **Impact:** evidence can disappear earlier under load, persist longer, or stop being recorded at the point it is most needed.
- **Required change:** say “while retained under the gateway's count and deletion policy,” configure the intended storage/auto-deletion behavior, alert on dropped logging, and revisit Logpush archival if duration is a requirement.

### EC-18 — Gateway span IDs and dashboard deep links are not documented outputs

- **Repository claims:** `docs/technical/01-architecture.md:130`, `docs/technical/07-ai.md:11,115,117,177,244,270`, decision D42, and product surfaces promise Gateway log/span IDs and a deep link.
- **Verdict:** **Partial.** AI Gateway returns a stable `cf-aig-log-id`. OTEL trace and parent-span IDs are caller-supplied correlation headers, not returned Gateway span identifiers. Logs are retrievable by log ID, but a durable dashboard deep-link contract is not documented.
- **Primary sources:** [AI Gateway feedback API/log ID](https://developers.cloudflare.com/ai-gateway/evaluations/add-human-feedback-api/), [OTEL integration](https://developers.cloudflare.com/ai-gateway/observability/otel-integration/), [AI Gateway Logs API](https://developers.cloudflare.com/api/resources/ai_gateway/subresources/logs/).
- **Impact:** the proposed schema/UI cannot reliably store or navigate the identifiers as described.
- **Required change:** store `gateway_log_id`. If tracing is required, generate and store application-owned OTEL trace/parent IDs and configure an exporter. Resolve native log details through the Logs API/filter rather than promising a permanent dashboard URL. Add a pinned-Flue spike proving response-header extraction and per-call metadata.

### EC-19 — infrastructure cost cannot be pulled from the planned Cloudflare API

- **Repository claims:** `docs/technical/01-architecture.md:56` and `docs/technical/12-operations.md:196,297,335` schedule daily infrastructure spend.
- **Verdict:** **Contradicted/volatile.** `GET /accounts/{account_id}/billable/usage` is Alpha/Restricted and explicitly does not populate cost and pricing fields.
- **Primary source:** [Cloudflare Get Account Usage](https://developers.cloudflare.com/api/resources/billing/subresources/usage/methods/get/).
- **Impact:** the infrastructure-spend series and related product display cannot be built from this endpoint. The secrets/bindings table also lacks the required account ID and Billing Read token.
- **Required change:** make automated infrastructure cost an open platform dependency. Use the billable-usage dashboard/budget alerts for now and label product usage metrics as usage, not cost. Re-enable only after account access and populated cost fields are demonstrated with a least-privileged credential.

### EC-20 — Alpaca market data is not an anonymous public endpoint

- **Repository claims:** `docs/technical/06-venues.md:22` and `docs/technical/05-the-tick.md:56` say public market data needs no key.
- **Verdict:** **Contradicted for Alpaca equities.** Except historical crypto, Alpaca market-data APIs require authentication. The Basic plan is IEX-only with documented rate/data restrictions; Plus supplies SIP/all-exchange coverage. Stock bars expose feed, adjustment, as-of, ordering, and pagination controls.
- **Primary sources:** [Alpaca Market Data API plans](https://docs.alpaca.markets/us/v1.1/docs/about-market-data-api), [Stock Bars](https://docs.alpaca.markets/us/reference/stockbars).
- **Impact:** the stated sleeve actor cannot fetch bars anonymously, and unpinned IEX/SIP/adjustment/as-of choices make live and historical datasets drift.
- **Required change:** provision a credential-owning data seam; pin plan/entitlement, feed, adjustment, as-of, currency, and sort in dataset/run fingerprints. Disclose and test IEX-versus-SIP execution/backtest mismatch.

### EC-21 — Australian Alpaca securities availability is commercially unverified

- **Repository claims:** `docs/PRODUCT.md:59-61`, `docs/product/02-sleeves.md:113-114`, and `docs/technical/06-venues.md:3,66-88` treat the Australian operator's US securities account as available.
- **Verdict:** **Unverified/account-specific.** Alpaca's current support page provides no country list and directs customers to support; non-US availability varies. The explicit Australia page applies to crypto, not a securities Trading API account.
- **Primary sources:** [countries where Alpaca is available](https://alpaca.markets/support/countries-alpaca-is-available), [non-US live accounts](https://alpaca.markets/learn/live-trading-account-non-us), [crypto regions](https://alpaca.markets/support/what-regions-support-cryptocurrency-trading).
- **Impact:** the wealth sleeve may have no usable live venue for this operator.
- **Required change:** make an approved, funded Australian-resident live securities Trading API account—or written support confirmation for the exact entity/account type—a launch gate. Paper signup is not proof.

### EC-22 — Alpaca events require two versioned normalizers

- **Repository claims:** `docs/technical/09-tax.md:65,164-179,437` treats conflicting activity codes as one table that a current pull can resolve.
- **Verdict:** **Contradicted framing.** The codes belong to two API generations: legacy immutable Account Activities and the new Activity SSE. The new API documents booked activity after 2026-02-11 while older history remains legacy.
- **Primary sources:** [legacy Account Activities](https://docs.alpaca.markets/us/docs/account-activities), [legacy pagination API](https://docs.alpaca.markets/us/reference/getaccountactivities-2), [Activity SSE](https://docs.alpaca.markets/us/docs/activity-sse).
- **Impact:** one pull cannot cover history correctly; corrections, busts, and older dividend/corporate-action codes can be lost or misclassified.
- **Required change:** implement versioned legacy-REST and new-SSE normalizers on both sides of the cutoff; map or review all dividend/fee/capital-gain-distribution codes and explicit corrections/busts.

### EC-23 — Activity SSE is not a complete order-lifecycle stream

- **Repository claims:** `docs/technical/06-venues.md:84,264` presents resumable Activity SSE as the push re-entry path for order updates.
- **Verdict:** **Partial.** SSE provides replayable financial activities/fills, but explicitly omits non-fill lifecycle events such as accepted, canceled, expired, and replaced.
- **Primary sources:** [Activity SSE](https://docs.alpaca.markets/us/docs/activity-sse), [SSE endpoint](https://docs.alpaca.markets/us/reference/subscribetoactivitiessse), [Alpaca WebSocket streaming](https://docs.alpaca.markets/us/docs/websocket-streaming).
- **Impact:** an SSE-only implementation misses lifecycle transitions.
- **Required change:** document a hybrid: Activity SSE/REST for immutable financial activities and fills; REST polling/lookup (or WebSocket plus REST recovery) for lifecycle. Remove unsupported categorical claims that the WebSocket “cannot replay.”

### EC-24 — Kraken fee and transfer semantics are wrong for tax

- **Repository claims:** `docs/technical/09-tax.md:62,141,150-161` treats either export's fee as usable and maps Kraken `transfer` as the operator's own-account movement.
- **Verdict:** **Contradicted.** Trades History fee is an estimate in quote currency; Ledger supplies the exact fee and currency. Ledger `transfer` can represent airdrops/forks, OTC, futures, or staking movements.
- **Primary sources:** [Kraken ledger vs trades history](https://support.kraken.com/articles/115000302707-differences-between-ledger-and-trades-history), [Kraken ledger fields](https://support.kraken.com/articles/360001169383-how-to-interpret-ledger-history-fields).
- **Impact:** fee assets/amounts and taxable events can be wrong.
- **Required change:** make Ledger authoritative for exact fee/currency and use Trade only for pair/context. Classify transfers from type, subtype, reference ID, and paired evidence; unknowns go to review, never automatically to no-event.

### EC-25 — the Kraken rate model is stale and conflates counters

- **Repository claims:** `docs/technical/06-venues.md:58` uses roughly 15 tokens, 0.33/s decay, and cost 2 for history.
- **Verdict:** **Contradicted.** Current verified private REST allowance is max 20 with 0.5/s decay; the relevant history endpoints cost 4. Trading calls use a separate per-account/per-pair counter.
- **Primary sources:** [Kraken REST rate limits](https://support.kraken.com/articles/206548367-what-are-the-api-rate-limits-), [Kraken trading rate limits](https://support.kraken.com/articles/360045239571-trading-rate-limits).
- **Impact:** backfills and trading can throttle unexpectedly; one budget cannot model both resources.
- **Required change:** implement separate public, private REST, and per-pair trading budgets; charge current endpoint weights; preserve ambiguous submissions on 429/5xx.

### EC-26 — Kraken archive gaps do not necessarily mean missing data

- **Repository claims:** `docs/technical/10-workbench.md:41` and the tick's gap semantics treat missing expected timestamps as source gaps.
- **Verdict:** **Contradicted for downloadable Kraken OHLCVT.** Archives contain only intervals in which trades occurred.
- **Primary source:** [Kraken downloadable OHLCVT data](https://support.kraken.com/articles/360047124832-downloadable-historical-ohlcvt-open-high-low-close-volume-trades-data).
- **Impact:** quiet intervals are falsely labeled corrupt/missing, changing backtest eligibility.
- **Required change:** distinguish confirmed zero-trade intervals from unobserved source intervals. Either materialize previous-close/zero-volume bars under an explicit policy or mark them nontradable without calling them data loss.

### EC-27 — the Division 775 monthly-average option is missing its reasonableness test

- **Repository claims:** `docs/technical/09-tax.md:197` and `docs/product/09-tax.md:30` treat a whole-financial-year choice as sufficient.
- **Verdict:** **Partial.** An average over a chosen period of at most 12 months is available only when it reasonably approximates applicable spot rates; consistency alone is not the test.
- **Primary source:** [ATO average exchange rates guidance](https://www.ato.gov.au/api/public/content/0-ae2dac92-eed2-4f82-8464-2a3f2165ad03).
- **Impact:** amounts can be translated with an impermissible approximation.
- **Required change:** record the selected period/source and a documented reasonableness assessment; otherwise use transaction-time rates. Replace “elected for the FY” with “configured after a reasonableness assessment.”

### EC-28 — wrapping is fact-specific, not a universal disposal with an override

- **Repository claims:** `docs/product/09-tax.md:28` and `docs/technical/09-tax.md:419` call disposal “the ATO's stated position” and offer an operator override.
- **Verdict:** **Partial/overstated.** A disposal default is reasonable for a typical token exchange, but ATO guidance says the applicable CGT event depends on the arrangement, beneficial ownership, and possible trust relationship; A1, E2, C2, or H2 may apply.
- **Primary sources:** [ATO DeFi and wrapping crypto](https://www.ato.gov.au/api/public/content/0-c61607c3-22a0-480f-878f-70292b745da3), [ATO crypto tax-time toolkit](https://www.ato.gov.au/api/public/content/901747cdfc5c41379b8413fc2ce5a456?v=023c532d).
- **Impact:** a fact-specific legal classification becomes an unsourced user toggle.
- **Required change:** classify protocol, rights, consideration, and beneficial ownership. Unknown wrappers go to accountant review; do not model the law as a naked override.

### EC-29 — 1042-S is one-to-many, USD, and whole-dollar rounded

- **Repository claims:** `docs/technical/09-tax.md:65,329,351,413`, `docs/product/09-tax.md:12,43,51`, and `docs/technical/examples/tax-cases.md:52,140` model “the annual 1042-S” as one object and reconcile at A$1.00.
- **Verdict:** **Contradicted/partial.** IRS instructions require separate Forms 1042-S by recipient, income type, and tax rate; amounts are USD and entries are rounded to whole dollars.
- **Primary source:** [IRS Instructions for Form 1042-S](https://www.irs.gov/instructions/i1042s).
- **Impact:** legitimate multiple forms—especially the spec's 15% and 30% cases—false-alert, and AUD tolerance is dimensionally wrong.
- **Required change:** store one-to-many forms keyed by calendar year, income code, rate, and unique form ID. Group raw USD activity correspondingly, round only the aggregate under IRS rules, and compare in USD with rounding-aware tolerance. Keep financial-year AUD translation separate.

### EC-30 — CommBank product copy overpromises export history and formats

- **Repository claims:** `docs/product/05-money.md:7,11` says NetBank exports CSV, OFX, and QIF with two years available and accepts any supported format. `docs/technical/08-money.md:323` rejects QIF.
- **Verdict:** **Contradicted/internally inconsistent.** CommBank advertises exports of up to 600 transactions in CSV/plain text, MYOB, Microsoft Money, and Quicken US/AU. It does not identify those dialects as OFX/QIF. NetBank separately exposes two years for viewing, not a guaranteed two-year export.
- **Primary sources:** [CommBank export guidance](https://www.commbank.com.au/support.digital-banking.export-transaction-information.html), [viewing older transactions/statements](https://www.commbank.com.au/support.digital-banking.see-old-transactions-in-netbank.html).
- **Impact:** first-run history and format compatibility are stronger in product copy than the technical parser can deliver.
- **Required change:** promise CSV initially and “up to 600 transactions per export.” Enable each Money/Quicken dialect only after real redacted fixtures prove it. Align the product copy with the explicit QIF rejection.

### EC-31 — CommBank PDF text extraction is not a provider contract

- **Repository claims:** `docs/technical/08-money.md:324` says statements are text-based and OCR is never required.
- **Verdict:** **Unverified.** No cited CommBank source guarantees document construction or text extractability.
- **Primary evidence:** the official pages above make no such promise.
- **Impact:** older-history ingestion can fail on a scanned or changed statement format.
- **Required change:** fixture-gate PDF extraction and retain OCR/manual fallback; do not promise “never.”

### EC-32 — PlanetScale failover timing and retries are misstated

- **Repository claims:** `docs/technical/03-data.md:57` attributes a 1–2 second failover to PlanetScale, while `docs/technical/12-operations.md:269` correctly warns not to assume it.
- **Verdict:** **Contradicted/internal conflict.** PlanetScale says failovers typically complete in seconds, but long-running queries can extend unavailability to 30 seconds. It recommends transactions below 3 seconds plus statement, transaction, and idle-in-transaction timeouts.
- **Primary source:** [PlanetScale Postgres connection resilience](https://planetscale.com/docs/postgres/connection-resilience).
- **Impact:** retry timing can prematurely fail or amplify load during failover.
- **Required change:** remove the 1–2 second claim, add role-level timeouts, keep transactions under 3 seconds, and preserve outcome-query/idempotent retry behavior.

### EC-33 — PlanetScale PITR has a plan/retention window and a recent-edge gap

- **Repository claims:** `docs/technical/12-operations.md:204-206` says PITR restores to a chosen minute and fills the nightly-dump gap without naming purchased retention or the recent edge.
- **Verdict:** **Partial.** PITR is available only within configured retention; default retention is two days, and targets stop five minutes before the present. Custom retention/backups cost extra.
- **Primary sources:** [PlanetScale PITR](https://planetscale.com/docs/postgres/backups/point-in-time-recovery), [PlanetScale backups](https://planetscale.com/docs/postgres/backups).
- **Impact:** the actual RPO and recoverable window are unspecified.
- **Required change:** record purchased retention and cost, state the five-minute PITR gap, set RPO/RTO, and test oldest-window and recent-edge restores.

### EC-34 — Hyperdrive cannot be exercised through a remote local binding

- **Repository claims:** `docs/technical/12-operations.md:31-32,87,279,309,326` says human local development uses remote Hyperdrive bindings and therefore exercises pooling/caching.
- **Verdict:** **Contradicted.** Remote binding connections do not support Hyperdrive. `localConnectionString` connects directly to Postgres and bypasses Hyperdrive behavior.
- **Primary source:** [Cloudflare local development bindings by environment](https://developers.cloudflare.com/workers/local-development/bindings-per-env/).
- **Impact:** the claimed everyday integration lane does not test the production database proxy.
- **Required change:** use `localConnectionString` for ordinary local work and say it bypasses Hyperdrive. Add a remotely executing dev Worker (`wrangler dev --remote` or deployed dev integration lane) for real Hyperdrive caching/pooling tests.

### EC-35 — Hyperdrive's origin connection limit is soft

- **Repository claims:** `docs/technical/03-data.md:107,372,395` budgets 8 origin connections per binding as a maximum.
- **Verdict:** **Partial.** Eight is configurable, but Cloudflare calls the limit soft and may exceed it for resiliency.
- **Primary sources:** [tune Hyperdrive connection pools](https://developers.cloudflare.com/hyperdrive/configuration/tune-connection-pool/), [Hyperdrive limits](https://developers.cloudflare.com/hyperdrive/platform/limits/).
- **Impact:** two bindings cannot be treated as a hard 16-connection ceiling against the PlanetScale plan.
- **Required change:** reserve headroom above 16 and alert on actual open/waiting metrics; keep the planned load/account proof.

### EC-36 — malformed messages do not immediately enter a native DLQ

- **Repository claims:** `docs/technical/04-contracts.md:98` says schema failures move immediately to the DLQ.
- **Verdict:** **Contradicted.** Native dead-letter routing happens only after configured retries are exhausted.
- **Primary sources:** [Queues batching/retries](https://developers.cloudflare.com/queues/configuration/batching-retries/), [dead-letter queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/).
- **Impact:** poison messages retry repeatedly, and the documented failure timing is wrong.
- **Required change:** either document retry-then-DLQ, or explicitly publish the body plus diagnostics to a bound DLQ producer and acknowledge the original only after that send succeeds.

### EC-37 — no consumer turns a dead letter into the promised feed event

- **Repository claims:** `docs/technical/04-contracts.md:102,202`, `docs/technical/07-ai.md:93,238,292`, and `docs/technical/03-data.md:312` promise `decision_record_lost` visibility.
- **Verdict:** **Contradicted as wired.** Native DLQ routing stores another queue message; it does not execute application-specific feed logic.
- **Primary source:** [Cloudflare dead-letter queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/).
- **Impact:** evidence loss can be silent.
- **Required change:** bind the DLQ to an idempotent consumer that writes the warning/attention row and verify its retention separately.

### EC-38 — the email and dead-man dependencies are not selectable contracts

- **Repository claims:** `docs/technical/12-operations.md:40,100,192,198` and `docs/technical/03-data.md:97-99` rely on `EMAIL_KEY`, acknowledged delivery, and an independent free uptime service.
- **Verdict:** **Unverified/unnamed.** No provider, endpoint, auth model, idempotency behavior, delivery-event meaning, rate limit, alert channel, or retention contract has been selected.
- **Evidence:** the named repository locations are the complete configuration; no provider appears elsewhere in `docs/` or the dependency catalog.
- **Impact:** the only system-halt interruption and the only detector for core's own death cannot be implemented or audited.
- **Required change:** select providers before launch, cite their official APIs, distinguish provider acceptance from inbox delivery, prove duplicate-safe email handling, and run the documented two-failure dead-man drill through a truly independent channel.

## P2 — limits, lifecycle, and wording corrections

| ID    | Repository claim                                                                                                                                                                         | Verdict and required correction                                                                                                                                                                                                                                                                                                        | Primary source                                                                                                                                                                                                                                                                                                                                |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EC-39 | `docs/technical/04-contracts.md:106,177,192` and `docs/technical/07-ai.md:93,227,255` use 128 KiB as the Queue ceiling.                                                                  | **Contradicted.** The limit is 128 KB/128,000 bytes. Budget serialized envelope overhead and set a smaller operational ceiling.                                                                                                                                                                                                        | [Queues limits](https://developers.cloudflare.com/queues/platform/limits/)                                                                                                                                                                                                                                                                    |
| EC-40 | `docs/technical/04-contracts.md:108,156,175` equates `max_retries=10` with ten delivery attempts.                                                                                        | **Contradicted.** There is an initial delivery plus retries. Use 9 retries for ten total attempts, or document 10 retries/11 attempts.                                                                                                                                                                                                 | [Queues pricing example](https://developers.cloudflare.com/queues/platform/pricing/)                                                                                                                                                                                                                                                          |
| EC-41 | `docs/technical/12-operations.md:101` says `AI_GATEWAY_TOKEN` carries spend caps.                                                                                                        | **Contradicted.** Spend limits are gateway rules scoped by model/provider/metadata; the token authenticates. Manage rules as separate config/IaC and assert them during deploy. Enforcement is eventually consistent, can overshoot under bursts, is a best-effort cost estimate, and is limited to 20 rules per gateway.              | [AI Gateway spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/)                                                                                                                                                                                                                                                |
| EC-42 | `docs/technical/11-app.md:165-172,263-264,279` combines a server timer every 30 seconds with a hibernating feed socket.                                                                  | **Contradicted.** Scheduled timers prevent hibernation. Use the Hibernation API, serialized socket attachments, client-initiated heartbeat with auto-response, and the one DO alarm for token expiry.                                                                                                                                  | [Durable Object WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)                                                                                                                                                                                                                          |
| EC-43 | `docs/technical/11-app.md:245` says a socket cannot outlive its authorization.                                                                                                           | **Partial.** JWT `exp` can bound the socket, but Access does not promise to tear down an already-upgraded origin socket on logout/revocation. Accept the window or use a short socket lease requiring an authenticated reconnect.                                                                                                      | [Access session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)                                                                                                                                                                                                             |
| EC-44 | `docs/technical/12-operations.md:208` broadly says compromised credentials cannot rewrite R2 history.                                                                                    | **Partial.** Object lock rules block delete/overwrite, but bucket administrators can remove the rules. Narrow the claim to object-write credentials; isolate bucket-admin credentials and alert on lock changes.                                                                                                                       | [R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)                                                                                                                                                                                                                                                                 |
| EC-45 | `docs/technical/12-operations.md:46` treats local Flagship values as local state.                                                                                                        | **Contradicted.** Wrangler local development uses the live Flagship app by `app_id`; there is no local flag store. Provision a separate dev app and keep kill=true as the evaluation fallback.                                                                                                                                         | [Flagship configuration](https://developers.cloudflare.com/flagship/configuration/), [binding API](https://developers.cloudflare.com/flagship/binding/)                                                                                                                                                                                       |
| EC-46 | `docs/technical/12-operations.md:117-132` assumes container image and Worker code promote together; `docs/technical/10-workbench.md:176-177` assumes a platform-supplied digest receipt. | **Partial/unverified.** Container rollout is staged by default, and current docs do not guarantee the runtime digest attestation the receipt assumes. Freeze new runs during rollout, wait for readiness, push immutable content-addressed tags, and inject/return the expected digest explicitly.                                     | [Container rollouts](https://developers.cloudflare.com/containers/platform-details/rollouts/), [image management](https://developers.cloudflare.com/containers/platform-details/image-management/)                                                                                                                                            |
| EC-47 | `docs/technical/12-operations.md:80,85` says a cross-Worker DO binding requires one combined local command.                                                                              | **Outdated.** Separate local Wrangler processes can provide an external DO Worker. Keep the combined command only as a convenience.                                                                                                                                                                                                    | [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)                                                                                                                                                                                                                                                   |
| EC-48 | `docs/technical/12-operations.md:93-105` describes secrets without the deployment side effect.                                                                                           | **Incomplete.** `wrangler secret put` immediately creates/deploys a version; versioned workflows use `wrangler versions secret put`. Treat rotation as deployment and reconcile it with the DO deployment choice.                                                                                                                      | [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)                                                                                                                                                                                                                                                           |
| EC-49 | `docs/technical/04-contracts.md:84` calls `runId` a Queue dedupe key.                                                                                                                    | **Misleading.** Queues are at-least-once and expose no producer custom dedupe key. Name it an application idempotency key backed by the Postgres unique constraint.                                                                                                                                                                    | [Queue delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)                                                                                                                                                                                                                                          |
| EC-50 | `docs/technical/12-operations.md:174,184` requires queue backlog vitals, but core is only a consumer.                                                                                    | **Design gap.** Backlog metrics come from a producer binding's `metrics()` or REST API and are best effort. Expose a narrow metrics read from the agents Worker or add a least-privileged Cloudflare metrics credential.                                                                                                               | [Queue metrics](https://developers.cloudflare.com/queues/observability/metrics/)                                                                                                                                                                                                                                                              |
| EC-51 | `docs/technical/03-data.md:26` presents 30-day Workflow history as universal.                                                                                                            | **Partial/volatile.** Completed state is 3 days Free/30 days Paid, and step/storage billing begins 2026-08-10. State the paid-plan dependency and add the new cost dimension.                                                                                                                                                          | [Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/)                                                                                                                                                                                                                                                           |
| EC-52 | `docs/technical/03-data.md:387` uses “no CDC” as an eternal D1 fact.                                                                                                                     | **Unprovable negative.** Keep the verified SQLite/exact-decimal and 10 GB rejection reasons; say no supported CDC contract was found as of this audit.                                                                                                                                                                                 | [D1 Worker API](https://developers.cloudflare.com/d1/worker-api/), [D1 FAQ/limits](https://developers.cloudflare.com/d1/reference/faq/)                                                                                                                                                                                                       |
| EC-53 | The platform register omits hard runtime ceilings used by burst fetches and handlers.                                                                                                    | **Omission.** Add Workers/DO memory, CPU/wall-time, six simultaneous outgoing connections, and per-object SQLite limits; test market-data bursts against the connection cap.                                                                                                                                                           | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/)                                                                                                                                                                                 |
| EC-54 | `docs/technical/06-venues.md:162` has no Alpaca account-wide request budget.                                                                                                             | **Omission.** Alpaca documents 200 Trading API requests/minute/account and 429 above it. Two-second per-order polling does not scale. Add an account budget/backoff and use Activities for fills.                                                                                                                                      | [Alpaca API usage limit](https://alpaca.markets/support/usage-limit-api-calls)                                                                                                                                                                                                                                                                |
| EC-55 | The long-only/cash product contract relies on intent logic alone.                                                                                                                        | **Incomplete.** Alpaca account config exposes no-shorting and margin-multiplier controls. Boot-assert settings compatible with the mandate rather than treating code intent as the account guarantee.                                                                                                                                  | [Alpaca account configuration](https://docs.alpaca.markets/us/reference/patchaccountconfig-1)                                                                                                                                                                                                                                                 |
| EC-56 | `docs/product/02-sleeves.md:114` says fractional/notional orders make rebalancing exact.                                                                                                 | **Overstated.** The documented safe envelope is market/day with exactly one of quantity/notional and a `fractionable` asset, but fills, precision/minimums, rounding, and residual cash prevent exact holdings. Say “target tracking.”                                                                                                 | [Alpaca Create Order](https://docs.alpaca.markets/us/reference/postorder), [fractional trading](https://docs.alpaca.markets/us/docs/fractional-trading)                                                                                                                                                                                       |
| EC-57 | `docs/product/04-portfolio.md:27` uses PayID/Osko as if direction-symmetric.                                                                                                             | **Partial.** Eligible AU Kraken accounts can deposit via Osko with generated PayID, but PayID withdrawals are not supported. Make rail wording direction-specific and read current account availability.                                                                                                                               | [Kraken AUD bank transfers](https://support.kraken.com/articles/360045033651-aud-bank-transfers-with-osko-and-payid)                                                                                                                                                                                                                          |
| EC-58 | `docs/technical/10-workbench.md:31` states hour-multiple Alpaca bars anchor to UTC.                                                                                                      | **Unverified.** The official Stock Bars contract supports ordering and pagination but does not establish that timestamp claim. Pin feed/adjustment/as-of/currency/sort and require a DST/session-boundary fixture.                                                                                                                     | [Alpaca Stock Bars](https://docs.alpaca.markets/us/reference/stockbars)                                                                                                                                                                                                                                                                       |
| EC-59 | `docs/technical/10-workbench.md:109,331` treats Kraken fee defaults and Alpaca “commission 0” as simulation facts.                                                                       | **Volatile/partial.** Kraken spot fees vary by pair, volume, maker/taker and tier; Alpaca may be commission-free for eligible trades but regulatory/clearing fees can remain. Capture current venue schedule in the manifest and keep realized ledger/activity fees authoritative.                                                     | [Kraken trading fees](https://support.kraken.com/articles/201893638-how-trading-fees-work-on-kraken), [Alpaca Account Activities](https://docs.alpaca.markets/us/docs/account-activities)                                                                                                                                                     |
| EC-60 | `docs/technical/06-venues.md:275` uses BTC/AUD as an example synthetic Kraken pair and suggests the generic mapping applies.                                                             | **Contradicted.** BTC/AUD is a native market. Synthetic orders have a narrower envelope and do not support the generic post/GTD attributes. Remove the example, query AssetPairs at boot, and reject synthetic pairs in v1 unless separately designed.                                                                                 | [Kraken markets](https://support.kraken.com/articles/kraken-markets), [synthetic pairs](https://support.kraken.com/articles/synthetic-pairs)                                                                                                                                                                                                  |
| EC-61 | Reconciliation and submission omit explicit venue-operability semantics.                                                                                                                 | **Omission.** Kraken publishes system/trading status and separate spot balance semantics; Open Positions is for margin positions, not spot holdings. Use Balance/Extended Balance plus spot orders/ledger, record pending withdrawals, and preserve reservations through maintenance/429/5xx.                                          | [Kraken system status](https://docs.kraken.com/api-reference/market-data/get-system-status), [Open Positions](https://docs.kraken.com/api-reference/account-data/get-open-positions), [Account Balance](https://docs.kraken.com/api-reference/account-data/get-account-balance)                                                               |
| EC-62 | `docs/technical/09-tax.md:196,198,405,412` uses nearest-prior RBA publication for dates without a rate.                                                                                  | **Partial.** RBA confirms weekend/NSW holiday gaps, but no general ATO income-tax source was found establishing the previous-RBA-business-day rule; the explicit prior-day source found is GST-specific. Preserve the actual publication date and label this an accountant-approved rate policy or use an actual/reasonable bank rate. | [RBA exchange rates](https://www.rba.gov.au/statistics/frequency/exchange-rates.html), [ATO FX overview](https://www.ato.gov.au/tax-rates-and-codes/foreign-exchange-rates-overview)                                                                                                                                                          |
| EC-63 | `docs/product/09-tax.md:32` and `docs/technical/09-tax.md:331` treat the W-8BEN three-year rule as the whole validity state.                                                             | **Partial.** The treaty claim is generally valid through the end of the third succeeding calendar year, but proper treaty fields, changed circumstances, and broker acceptance matter; other form aspects can differ. Record form version, country/treaty claim, broker status, and changed-circumstance events.                       | [IRS Instructions for Form W-8BEN](https://www.irs.gov/instructions/iw8ben)                                                                                                                                                                                                                                                                   |
| EC-64 | `docs/product/05-money.md:7` and `docs/technical/08-money.md:325` say CDR sync requires an accredited intermediary.                                                                      | **Directionally correct but too narrow.** Valid routes include direct/unrestricted or sponsored accreditation, representative arrangements, and eligible outsourcing. State the broader regulated-path requirement, then select one architecture.                                                                                      | [CDR accreditation guidelines](https://www.cdr.gov.au/resources/guides/accreditation-guidelines), [OAIC outsourcing obligations](https://www.oaic.gov.au/consumer-data-right/consumer-data-right-guidance-for-business/privacy-obligations/cdr-outsourcing-arrangement-privacy-obligations-for-a-principal-of-an-outsourced-service-provider) |
| EC-65 | `docs/technical/01-architecture.md:21` and the build plan rely on Effect V4 while only the appendix calls it a pinned beta.                                                              | **Volatile.** The local catalog pins `4.0.0-beta.105`, and the APIs used are pre-release/unstable. Put the exact beta and migration/rollback risk in the platform register; run contract tests against that exact source. Do not infer “stable V4” from the architecture name.                                                         | [Effect releases](https://github.com/Effect-TS/effect/releases), local `pnpm-workspace.yaml:11` and `.repos/effect`                                                                                                                                                                                                                           |
| EC-66 | `docs/technical/04-contracts.md:17` says `HttpApiClient` runs directly against a service binding's `fetch`.                                                                              | **Feasible but incomplete.** Effect's client requires an `HttpClient`; no documented Cloudflare Service Binding adapter is supplied. Specify an adapter preserving aborts, streaming, and error mapping, then test one endpoint over a real binding. Server `Request -> Response` conversion is supported.                             | [Effect HttpApiClient](https://effect-ts.github.io/effect/platform/HttpApiClient.ts.html), [HttpClient](https://effect-ts.github.io/effect/platform/HttpClient.ts.html), [HttpApiBuilder](https://effect-ts.github.io/effect/platform/HttpApiBuilder.ts.html)                                                                                 |
| EC-67 | `docs/technical/11-app.md:3,211,223` treats TanStack Start as an unqualified production dependency.                                                                                      | **Volatile.** Official docs still label Start a release candidate. Pin the exact version and retain deployment/server-function smoke tests in the assumption register.                                                                                                                                                                 | [TanStack Start overview](https://tanstack.com/start/latest/docs/framework/react/overview)                                                                                                                                                                                                                                                    |
| EC-68 | `docs/technical/03-data.md:33` says `timestamptz` is always UTC.                                                                                                                         | **Partial wording.** PostgreSQL stores instants internally as UTC but renders them in the session time zone, and Hyperdrive does not preserve session state. Parse instants explicitly and use role-level UTC or explicit formatting; never rely on a session `SET`.                                                                   | [PostgreSQL date/time types](https://www.postgresql.org/docs/current/datatype-datetime.html)                                                                                                                                                                                                                                                  |
| EC-69 | `docs/technical/12-operations.md:210` is vague about restoring into a PlanetScale branch.                                                                                                | **Feasible with explicit mechanics.** A normal UI-created Postgres branch is empty; backup-created branches contain restored state but omit extensions. Say create an empty dev branch, run migrations, then `pg_restore`, or use a backup-created branch deliberately.                                                                | [PlanetScale branching](https://planetscale.com/docs/postgres/branching), [backups](https://planetscale.com/docs/postgres/backups/)                                                                                                                                                                                                           |

## Verified advertised contracts

These findings support the architecture. They are not substitutes for account fixtures where the system depends on exact response behavior.

### Cloudflare

- Durable Object SQLite supplies transactional, strongly consistent storage; each object has one alarm; alarms are at least once with six automatic retries. [Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), [SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).
- Workers implementing Durable Objects do not receive preview URLs, so the need for an alternative pre-production/protected rollout path is real. [Preview URL restrictions](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/).
- Code updates disconnect Durable Object WebSockets; reconnect and replay are necessary. [Durable Object WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).
- Service bindings are private capability bindings and support HTTP. Native RPC ignores Smart Placement; leaving Smart Placement disabled until measured is sound. [Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/), [Smart Placement](https://developers.cloudflare.com/workers/configuration/placement/).
- Hyperdrive writes do not invalidate cached reads; cached and uncached configurations are supported; transaction pooling does not preserve session state. Explicitly set both the 60-second max age and 15-second stale interval if the spec wants a 75-second bound. [Query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/), [how Hyperdrive works](https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/).
- Hyperdrive advertises PlanetScale/Postgres.js compatibility. This supports the direction but does not remove the planned real-binding integration tests or the need for `nodejs_compat`, supported driver versions, and request-scoped clients. [Hyperdrive overview](https://developers.cloudflare.com/hyperdrive/), [Postgres example](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/).
- R2 object/binding operations are strongly consistent and remote R2 local bindings exist. The architecture correctly avoids relying on object versioning. [R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/), [R2 Workers API](https://developers.cloudflare.com/r2/get-started/workers-api/).
- Access assertion verification through `Cf-Access-Jwt-Assertion` is correct; Cloudflare recommends the header because the cookie is not guaranteed. `X-Requested-With: XMLHttpRequest` supports the intended 401 behavior for expired AJAX requests. [JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/).
- AI Gateway supports metadata-scoped spend rules and cost analytics, with eventual consistency and best-effort cost estimates. It is an appropriate backstop, not the exact engine budget authority. [Custom metadata](https://developers.cloudflare.com/ai-gateway/observability/custom-metadata/), [spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/).
- Workflows support the documented 1 MiB non-streaming step result and long waits/sleeps up to 365 days, subject to plan and retention qualifications. [Workflow limits](https://developers.cloudflare.com/workflows/reference/limits/).
- Containers are GA, have ephemeral local disk, support controlled Workers-binding bridges/egress, and require Workers Paid. [Containers](https://developers.cloudflare.com/containers/), [GA announcement](https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/).
- Flagship is public beta and propagation can take up to 30 seconds, matching the existing fail-closed design. [Flagship beta](https://developers.cloudflare.com/changelog/post/2026-05-26-public-beta/), [Flagship concepts](https://developers.cloudflare.com/flagship/concepts/).

### Kraken and Alpaca

- Kraken requires an increasing nonce per key. `GetApiKeyInfo` exposes current nonce, permission/restriction state, and IP allowlist, so boot can compare the durable nonce and enforce an exact permission allowlist. [REST authentication](https://docs.kraken.com/exchange/guides/rest-authentication), [Get API Key Info](https://docs.kraken.com/api-reference/account-data/get-api-key-info).
- Kraken Add Order supports its documented client-ID shapes, 2–60 second `deadline`, post-only, and `validate`. The validate flag is on the order-capable endpoint with no separate documented permission exemption. [Add Order](https://docs.kraken.com/api-reference/trading/add-order).
- Kraken has no generally available spot sandbox; its test environment is restricted to qualified clients. [Advanced API FAQ](https://support.kraken.com/articles/advanced-api-faq).
- Kraken OHLC REST returns no more than 720 recent entries and always includes the current uncommitted interval. [OHLC](https://docs.kraken.com/api-reference/market-data/get-ohlc-data).
- Kraken's export API supports the planned ledger/trades request/status/retrieve workflow with the documented query permissions. [Kraken history export API](https://support.kraken.com/articles/360025484891-how-to-export-your-account-history-via-api).
- Alpaca day orders expire/cancel after the session; after-close submissions queue for the next trading day. This is a session-close backstop, not a mirror of a 30-minute fill window. [Alpaca Create Order](https://docs.alpaca.markets/us/reference/postorder).
- Alpaca paper uses separate credentials and a similar API shape but omits market impact, realistic latency/slippage, queue position, price improvement, regulatory fees, and dividends; it uses IEX data. The spec is right to use it for adapter integration rather than the shared dry-run fill model. [Paper trading](https://docs.alpaca.markets/us/docs/paper-trading).
- Legacy Alpaca Account Activities have immutable IDs and pagination. Preserve them for pre-cutover history. [Account Activities API](https://docs.alpaca.markets/us/reference/getaccountactivities-2).
- Australian Kraken AUD deposits through Osko/PayID are advertised for eligible matching accounts, subject to the direction correction in EC-57. [Kraken AUD transfers](https://support.kraken.com/articles/360045033651-aud-bank-transfers-with-osko-and-payid).

### Framework, database, banking, and tax

- Flue supports overriding a built-in provider ID while preserving catalog metadata and changing its base URL, which makes a gateway-fronted provider feasible. Wire compatibility and response-header extraction still need the pinned-version spike. [Flue models](https://flueframework.com/docs/guide/models/), [provider API](https://flueframework.com/docs/api/provider-api/).
- Effect supports arbitrary-precision `BigDecimal` and Schema transformations. Exact Postgres NUMERIC → string → BigDecimal behavior remains an integration test. [Effect Schema](https://effect-ts.github.io/effect/effect/Schema.ts.html), [BigDecimal](https://effect-ts.github.io/effect/effect/BigDecimal.ts.html).
- PlanetScale advertises standard Postgres support for the core DDL/types and roles. PostgreSQL supports column grants and advisory locks, so the migration/direct-session direction is feasible. [PlanetScale compatibility](https://planetscale.com/docs/postgres/postgres-compatibility), [roles](https://planetscale.com/docs/postgres/connecting/roles), [PostgreSQL grants](https://www.postgresql.org/docs/current/ddl-priv.html), [advisory locks](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS).
- CommBank advertises export fields including date, signed amount, details, and account balance, with up to 600 transactions. It does not prove headerlessness, column counts, account-specific signs, posted-only behavior, ordering, FITID stability, or OFX/QIF dialect. The technical chapter is correct to keep those fixture-gated. [CommBank export guidance](https://www.commbank.com.au/support.digital-banking.export-transaction-information.html).
- ATO guidance supports FIFO/LIFO/HIFO specific identification when adequate records identify parcels; the spec's location scope is a conservative product policy. [ATO share/unit CGT toolkit](https://www.ato.gov.au/api/public/content/4b8c14fa-eaae-4e76-9487-93de5c1a64a8_TaxTimeToolkit_Captialgainstaxonsaleofsharesandunits_pdf), [Taxation Determination TD 33](https://www.ato.gov.au/law/view/document?LocID=%22CGD%2FTD33%2FNAT%2FATO%22&PiT=99991231235958).
- FIFO is the normal Division 775 rule for fungible foreign currency; weighted average needs its own written election. [ATO FIFO guidance](https://www.ato.gov.au/businesses-and-organisations/corporate-tax-measures-and-assurance/foreign-exchange-gains-and-losses/in-detail/use-of-first-in-first-out-method-for-fungible-assets-rights-and-obligations), [regulation 775-145.01](https://www.ato.gov.au/law/view/print?DocID=REG%2F20210206%2F775-145.01).
- The spec's W-8BEN example ending on 2025-12-31 for a form signed in 2022 is generally correct, subject to EC-63's qualifications. [IRS W-8BEN instructions](https://www.irs.gov/instructions/iw8ben).
- The A$1,000 FITO shortcut, limit calculation above it, and no carry-forward/refund of unused FITO are supported. [ATO FITO guide](https://www.ato.gov.au/forms-and-instructions/foreign-income-tax-offset-rules-guide-2018/calculating-and-claiming-your-foreign-income-tax-offset), [ITAA provision](https://www.ato.gov.au/law/view/document?LocID=%22PAC%2F19970038%2F770-75%282%29%22).

## Correctly deferred dependencies

These are honest open questions with safe inactive/manual fallbacks. They should stay deferred rather than be “validated” against a provider that has not been selected.

- `docs/technical/09-tax.md:64,200,440`: chain-data and crypto-price providers. Manual CSV and no-price review are safe; wallet sync/timestamp valuation must not ship before a selected provider contract and known-wallet fixture.
- `docs/technical/07-ai.md:154,264,281-283`: model choice and news/calendar/venue-status adapters. The capabilities are inactive/fail-closed, which is the correct posture until licensing, correction, retention, and outage contracts exist.
- `docs/technical/08-money.md:38-53,338-343`: empirical CommBank parser details. The real redacted fixture list is the correct source of truth.

## Mandatory conformance and written-confirmation gates

Official documentation establishes advertised behavior; the following claims are account-specific, race-sensitive, or explicitly undocumented and must be closed with recorded evidence.

| Gate                           | Must be proven before                         | Required evidence                                                                                                                                                                          |
| ------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Kraken GTD expiry              | Any live Kraken order                         | Validate UUIDv7 `cl_ord_id`; submit GTD+`expiretm`; verify unfilled and partially filled remainder expiry and final `vol_exec`.                                                            |
| Kraken ambiguous submit        | Automatic failure/release after timeout       | Force client timeouts and observe Open/Closed/Trades/Ledger visibility. Keep quarantine unless Kraken supplies a written consistency SLA.                                                  |
| Kraken key posture             | Venue integration                             | Compare durable nonce with `GetApiKeyInfo`; assert exact required/allowed permissions and IP restrictions, including denial of withdraw/add/update-address scopes.                         |
| Kraken market/product envelope | Live Kraken mandate                           | Query native AssetPairs, reject synthetic routes in v1, capture actual fee tier, exercise REST and trading throttles, and test stop replacement/simultaneous trigger behavior.             |
| Australian Alpaca account      | Any live wealth sleeve                        | Approved and funded Australian-resident securities Trading API account or written confirmation for the exact account/entity.                                                               |
| Alpaca ambiguity/idempotency   | Any resubmit after a timeout                  | Written support statement plus live tests for lookup races and duplicate IDs after filled/canceled/expired/rejected. Until then: lookup miss → quarantine.                                 |
| Alpaca order/product envelope  | Live Alpaca mandate                           | Paper then low-notional live canary for qty/notional, fractional precision/minimum, `fractionable`, stops, overlapping stops, after-hours queueing, and account no-shorting/margin config. |
| Alpaca funds-transfer boundary | Claim that a stolen key cannot exfiltrate     | Negative-test wallet/list, whitelist creation, and transfer creation with the production credential; obtain written confirmation of any enforceable disabled state.                        |
| Alpaca data/events             | Reliance on equities bars or activity history | Prove IEX/SIP entitlement, 15-minute restriction, 200/min throttling, DST/session timestamps, SSE cursor replay/corrections/busts, and legacy coverage through 2026-02-11.                 |
| Venue reconciliation           | Any live venue                                | Recorded fixtures for partial fills, non-quote fees, external orders, pending transfers, maintenance during ambiguous submit, dividends/corporate actions, and stop recovery.              |
| Cloudflare Access              | Any service-token caller                      | Token for two different machine callers behind one Access app; prove `aud` validation plus `common_name` authorization and rejection of the other token.                                   |
| DO deployment                  | First scratch deployment                      | Prototype chosen `exports`/legacy migration path, route/Cron propagation, forced verification failure, and rollback restrictions on a DO Worker.                                           |
| Feed ordering/hibernation      | Live feed                                     | Interleave live events during delayed replay, deploy/reconnect, cursor replay, token expiry, and client heartbeat; assert sorted exactly-once presentation at protocol level.              |
| Hyperdrive/PlanetScale         | Schema freeze/live promotion                  | Deployed dev-Worker test for cached/uncached behavior, session-state assumptions, driver lifecycle, soft connection ceiling, failover, and exact NUMERIC decoding.                         |
| Flue/Gateway                   | First AI capability                           | Pin versions; prove base-URL override, no vendor-direct route, per-call metadata, `cf-aig-log-id` extraction, persisted fields, retention/deletion behavior, and any OTEL correlation.     |
| Compute trust boundary         | First backtest/proposal                       | Restricted egress, content-addressed R2 read/write, returned hash/digest, trusted core verification/commit, rollout version match, and no DB secret visible to untrusted code.             |
| Division 775                   | First FY computation                          | Accountant-reviewed account eligibility; golden cases for separate credit/debit totals, statutory rate, two buffer periods, A$500k ceiling, cross-FY period, FRE1/FRE2/FRE4 treatment.     |
| 1042-S                         | First foreign-income report                   | Multiple forms in one calendar year, income-code/rate grouping, USD whole-dollar rounding, and separation from FY AUD translation.                                                         |
| CommBank parser                | First production import per profile           | The complete redacted fixture list already specified in `docs/technical/08-money.md`, including overlap, identical rows, encodings, maximum export, and each actual dialect.               |
| Email/dead-man                 | Live capital                                  | Selected provider contracts, duplicate-safe accepted email, provider-vs-inbox semantics, and an end-to-end two-failure outage drill through the independent channel.                       |

## Applied documentation remediation

### 1. Unsafe contracts corrected

- `docs/technical/06-venues.md`: EC-01 through EC-04, EC-10 through EC-12, EC-20 through EC-26, and EC-54 through EC-61. Make quarantine the default for ambiguous negative lookups; separate order lifecycle from execution activities; define per-venue/product stop envelopes.
- `docs/technical/09-tax.md` and `docs/product/09-tax.md`: EC-06 through EC-08, EC-22, EC-24, EC-27 through EC-29, EC-62, and EC-63. Replace prose thresholds with sourced event/state rules and versioned external schemas.
- `docs/technical/04-contracts.md` and `docs/technical/11-app.md`: EC-05, EC-09, EC-36, EC-37, EC-39, EC-40, EC-42, and EC-43.

### 2. Platform architecture and runbook reconciled

- `docs/technical/12-operations.md`: choose the DO deployment model; add triggers/secret semantics; correct Hyperdrive local development, PITR/RPO, billing, Queue metrics, workflow plan/cost, Flagship dev app, provider selection, and hard runtime limits.
- `docs/technical/10-workbench.md` and `docs/technical/01-architecture.md`: move Postgres writes out of untrusted compute, add narrow R2 outbound handlers, freeze runs during container rollout, and make digest identity application-attested.
- `docs/technical/07-ai.md` and `docs/technical/03-data.md`: replace the temporary/Gateway-only retention model with the actual Flue durable-state inventory; store Gateway Log ID and application-owned trace IDs.

### 3. Product promises corrected

- `docs/PRODUCT.md`, `docs/product/02-sleeves.md`, and `docs/product/04-portfolio.md`: qualify Australian Alpaca availability, funds-transfer risk, fractional “exactness,” stop coverage, and direction-specific Kraken AUD rails.
- `docs/product/03-activity.md`: replace 7–30 day trace retention and undocumented deep-link promises.
- `docs/product/05-money.md`: promise CSV/up to 600 initially, align QIF rejection, and state the broader CDR regulated-path requirement.
- `docs/product/09-tax.md`: correct Division 775, wrapping, W-8BEN, and plural 1042-S language.

### 4. Account-sensitive claims remain release artifacts

For each gate above, archive:

- source URL and review date;
- request/response fixture with secrets and personal data redacted;
- account/plan/entitlement and provider version;
- expected behavior and observed result;
- expiry/re-review trigger;
- safe behavior while the evidence is missing or stale.

The quarterly platform register should be expanded from a prose table to this record shape. Contract evidence tied to a live-trading guarantee should also be checked on relevant provider changelog events, not only quarterly.

## Empirical closure criteria

The written-contract remediation is complete. The external-contract audit can be closed empirically when:

1. every P0/P1 repository location has been corrected or explicitly rejected with equally strong primary evidence;
2. the mandatory gates have owners and phase/release milestones in the roadmap;
3. unnamed live dependencies have selected providers and cited contracts;
4. the architecture no longer promises behavior that only a paper account, dashboard setting, or undocumented race is expected to provide;
5. each external adapter has contract tests for decoding, limits, lifecycle, idempotency/ambiguity, and correction/reversal behavior;
6. the platform register records plan/version/account qualifications and the date each source was last reviewed.

Until those conditions hold, the safe system posture is: no live venue orders, no automated Division 775 election treatment, no claim of permanent-vs-temporary AI data handling, and no product promise that depends on an unselected or commercially unverified provider.
