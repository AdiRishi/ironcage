# The frontend

The observatory is a TanStack Start application (React 19) deployed on Cloudflare Workers, sitting behind Cloudflare Access. This document specifies its data flow and structural rules; visual design is a separate pass (`docs/PRODUCT.md` defines *what* each view conveys).

## Shape

- **TanStack Start** with file-based routes mapping one-to-one onto the product's surfaces: Overview, Sleeves (+ per-sleeve living view), Activity, Money, Reports, Workbench, and the operations screens (mandate review, incident reports, override flow).
- **Server functions are the only data access.** They run in the Worker, query D1 (and R2 for report bodies/snapshots), decode through `@app/contracts`, and return typed data. The browser never touches D1, R2, venue anything, or AI anything. The web app holds no secrets beyond its D1/R2 bindings.
- **TanStack Query** manages server state with per-view staleness budgets; every payload carries the `asOf` timestamps the product's honesty rules require (data freshness is displayed, never implied).

## Liveness

The product demands updates "within seconds" while a view is open. Mechanism: a **BroadcastDO** — one Durable Object fanning out server-sent events. State-changing writers (engine, grants, jobs) POST a lightweight notification (`{topic, ids}`) to it after committing; the web app's server function exposes an SSE endpoint bridged from the DO (WebSocket hibernation API keeps idle cost ~zero); the client subscribes per view and *invalidates the relevant queries* on notification — data still flows through the one server-function path, so SSE can be lost safely (fallback: TanStack Query's interval refetch). Losing the stream flips the page's connection indicator to degraded — dead data never renders as live.

## Write paths (operator actions)

All operator actions — pause/flatten/halt, allocation acts, mandate reviews and approvals, override arming, acknowledgments, imports — are server functions that validate against contracts, perform the act in a transaction *with its feed event*, and notify the BroadcastDO. Two are special:

- **Mandate changes and proposal approvals** share one review server function: it renders the diff + reasoning + (for proposals) gate results, and on confirm writes the `mandate_versions` row — the "no second door" rule is enforced by there being exactly one code path.
- **The override flow** is a small state machine persisted in D1 (`armed → cooling → active → expired/used`), with timestamps enforced server-side (the 15-minute cooling-off is checked against the armed row, not a client timer). The cage's effective-limit computation reads active overrides from this table; expiry is a time comparison, not a background job that could fail to run.

## The dashboard cannot trade

Structural, not disciplinary: the web Worker has no gateway-client dependency, no service binding to the engine's trading paths, and no AI keys. Its only interactions with the engine are the recorded operator actions above, which flow through D1 rows the DOs consume — the same one-way, through-the-database pattern as the AI (ADR-0001 applied to the UI).

## Frontend conventions

- Money renders from decimal strings via a single formatting module (never `parseFloat` in a component — a lint rule enforces it).
- Dry-run and live data carry a mode tag end-to-end from the database and are styled distinctly by a shared component, so no view can accidentally conflate them.
- The charting layer (equity curves, sparklines, ledgers) is one shared component set fed by typed series — the design pass will style it; the data contract (series, asOf, mode tags, deposit/withdrawal markers) is fixed here.
- Auth: Cloudflare Access in front of everything (`/api/sse` included); the Worker additionally validates the Access JWT so a misconfigured zone fails closed. One policy, one operator email + passkey.
