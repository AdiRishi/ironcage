# Integrations

Two trading venues by deliberate consolidation, one bank via file export, two AI providers behind one gateway. Every integration sits behind a seam: a typed client in its own module, so a venue change is a module swap, never a system change.

## Kraken (crypto — the first venue)

- **Why**: AUSTRAC-registered Australian entity, free PayID/Osko AUD rails, real AUD pairs, mature REST/WebSocket API, and — decisively — **API keys with IP allowlisting, granular permissions, and no withdrawal rights**, pinned to the gateway's static IP.
- **Trading**: through the gateway only. Spot, limit + market, client order IDs for idempotency. The gateway uses Kraken's REST API directly (thin, few endpoints) rather than dragging in ccxt — fewer dependencies on the machine that holds keys; the request-signing recipe is small and well-documented.
- **Market data**: public OHLC/order-book endpoints called directly from `apps/collector` (no auth, no gateway needed). Rate-limit math is comfortable by orders of magnitude at 4h cadence for a handful of pairs.
- **Account setup ritual** (recorded in ops runbook): dedicated API key per environment; trade + query permissions only; withdrawals disabled at the key _and_ confirmed at account level; IP-locked to the VPS.

## Alpaca (US stocks & ETFs — the long-term wealth venue)

- **Why**: available to Australian individuals, $0 commissions, clean API-key REST (no resident gateway process, no OAuth ceremony), fractional/notional orders that make ETF rebalancing exact, and a first-class paper environment.
- **Trading**: through the gateway (keys live only there; Alpaca doesn't offer key IP-locking, so containing the key to one machine is the compensating control). Notional orders for contributions and rebalances; market hours respected by the sleeve's cadence (daily tick after US close computes; orders queue for next open).
- **Market data**: the free IEX feed suffices for daily/4h ETF candles — pulled via the gateway's `/alpaca/candles` route, because **Alpaca's data API requires key authentication even on the free tier** and keys live only on the gateway. Known limitation, accepted: IEX-only quotes can diverge from NBBO; irrelevant at rebalancing cadence, noted in the sleeve's simulation caveats.
- **Simulated-trading environment**: Alpaca's own sandbox is used for gateway integration tests only. Ironcage's dry run (our simulator against live data) remains the proving ground — one honesty model, ours.
- **Onboarding verifications** (flagged, non-blocking): international funding mechanics (wire/FX cost), current AU feature set.

## The gateway service (`apps/gateway`)

A single small Effect application on the static-IP VPS, reachable **only** via Cloudflare Tunnel (no inbound ports, no public DNS). Its entire API:

```
GET  /health                     → venue reachability + key validity (no secrets)
GET  /:venue/balances
GET  /:venue/orders/open
GET  /:venue/fills?since=…
GET  /:venue/candles?…           (primary for Alpaca — its data API is
                                  authenticated; fallback only for Kraken)
POST /:venue/orders              (idempotent via client order id)
POST /:venue/orders/:id/cancel
```

Properties, enforced in its ~small codebase: request/response shapes are `@app/contracts` schemas (decode in, encode out); it holds venue keys in its environment and nothing else holds them; it contains zero strategy, risk, or retry-policy logic (retries live in the trade pipeline, so behavior is visible in Workflow state, not hidden at the edge); it logs every call with client order id to its local journal _and_ the caller records the same — two sides of every conversation. Service-to-service auth: the Tunnel makes it unreachable publicly; calls additionally carry a shared-secret header rotated with deploys. Deployment: a systemd unit + a deploy script over SSH from CI-less local (`pnpm deploy:gateway`); the VPS is pet-simple on purpose.

## CommBank import (the Money view)

Parsers for the three NetBank export formats — CSV, OFX, QIF — in `@app/core/import` (pure: bytes → `Transaction[]` + diagnostics). Format auto-detection by content, not extension. Dedup key: stable hash of account + date + amount + normalized narrative, with a fuzzy window for the bank's narrative reformatting habits; the unique index on that hash makes re-imports idempotent at the database level. Transfer detection pairs opposite-signed same-amount transactions across the operator's own accounts within a date window. Categorization: rules first (operator-taught, stored in `category_rules`), then an AI classification service for the remainder — an insight-arm AI use governed by the same honesty rules as grants (schema-validated output, audit snapshots, operator-correctable) but deliberately outside the grant registry, which binds to trading; its product-specified behavior (auto-apply above a confidence threshold, review queue below it) lives in `docs/product/04-money.md`. No bank credentials exist anywhere in the system — the CDR/API upgrade remains a named future decision.

## AI providers

Anthropic (primary) and OpenAI (fallback), exclusively through **Cloudflare AI Gateway**: one base URL per provider, caching on (identical regime contexts within a tick window dedupe), cost per request captured for the grant ledgers, automatic retry, and the fallback chain configured per grant class. Provider API keys live as Worker secrets in `apps/grants`/`apps/jobs` only — the engine and web app have no AI keys at all, by construction.

## FX

Whole-of-wealth AUD reporting needs one honest rate source: the collector stores a daily AUD/USD candle (from Kraken's AUD pairs or a public reference rate) and every converted figure carries its rate timestamp. Sleeves never convert — they account natively; conversion is a display-time concern.
