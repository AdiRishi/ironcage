# App

The observatory's implementation: a TanStack Start application in `ironcage-app` ([D18](./00-decisions.md#d18), [D26](./00-decisions.md#d26)). The product defines what every view must convey ([PRODUCT.md](../PRODUCT.md) and the per-surface docs); this chapter specifies the app's structure, its three data paths, the shell, and the liveness rules.

## Structure

Routes mirror the product's surfaces one-to-one: Overview, Sleeves (roster + living views), Activity, Portfolio, Money, Reports, Workbench, Tax, and the operations controls woven through them. Components build on **shadcn/ui**, with **Vercel AI Elements** (copy-in, dependency-free) for conversational chrome — effort goes into the observatory's substance, not primitives ([D26](./00-decisions.md#d26)). The app Worker holds one binding (core) and no state; it can be redeployed at any moment with zero risk to anything.

## Three data paths

1. **Request/response** — server functions call core's `AppApi` through the generated typed client over the service binding; TanStack Query owns caching, with query keys per domain aggregate. Mutations (every ceremony, every control) are server functions too — the browser never holds a credential for anything but its own session.
2. **The live feed** — a server function mints a short-TTL signed ticket; the browser opens a WebSocket to an app-Worker route that validates the ticket and proxies the upgrade to the feed actor ([D26](./00-decisions.md#d26)). Feed events land in a client store that (a) renders the Activity surfaces and (b) invalidates the affected query keys — the feed is also the cache-invalidation signal, which is what makes the observatory live without polling.
3. **Conversations** — the Workbench's research-agent chat mounts Flue's conversation routes through an app-Worker proxy (session-checked, streamed unbuffered) and renders with `@flue/react`. No Vercel AI SDK anywhere ([D26](./00-decisions.md#d26)).

## The shell

The product's always-present elements ([PRODUCT.md](../PRODUCT.md)) are one layout component fed by one small subscription: system mode + halt-all control, unacknowledged-critical count, override banner, connection indicator, and the mode discipline. Two implementation rules:

- **The halt-all control is a direct server-function call with a confirm — no ceremony, no additional gates** — wired to core's always-available risk-reducing surface ([Cage](./05-cage.md)). It must work when everything else is broken, so it depends on nothing but the binding.
- **Mode discipline is a type, not a style**: every API payload carrying sleeve data carries its mode (`dry-run | live`), the client's domain types preserve it, and the tagged component variants render it — a screen cannot conflate modes without failing to type-check.

## Liveness and honesty

- Every displayed datum carries its **as-of time** from the API, rendered relative and tooltipped absolute. Values the app cannot refresh render as *unknown/stale*, never as their last value pretending to be current.
- The WebSocket's state drives the **connection indicator**: disconnected → visible degraded state, data marked stale, automatic reconnect with backoff; on reconnect the client re-reads the feed cursor from the API — push is an optimization, the record is the truth ([Topology](./02-topology.md)).
- Equity curves and sleeve summaries poll their queries at gentle intervals *while visible* as a safety net under the feed-driven invalidation; nothing polls when the tab is hidden.

## Auth

Deferred decision ([D21](./00-decisions.md#d21)) with a fixed seam: the app Worker owns a session (whatever provides it — Clerk or Cloudflare Access), every server function asserts it, the ticket route derives from it, and core trusts the app binding. Nothing else in the system participates in authentication, so the deferred choice stays a one-Worker swap. Sessions expire; there is exactly one operator and no other role.
