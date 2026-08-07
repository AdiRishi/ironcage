# App

The observatory's implementation: a TanStack Start application in `ironcage-app` ([D18](./00-decisions.md#d18), [D26](./00-decisions.md#d26)). The product defines what every view must convey ([PRODUCT.md](../PRODUCT.md) and the per-surface docs); this chapter specifies the app's structure, its three data paths, the shell, and the liveness rules.

## Structure

Routes mirror the product's surfaces one-to-one: Overview, Sleeves (roster + living views), Activity, Portfolio, Money, Reports, Workbench, Tax, and the operations controls woven through them. Components build on **shadcn/ui**, with **Vercel AI Elements** (copy-in, dependency-free) for conversational chrome — effort goes into the observatory's substance, not primitives ([D26](./00-decisions.md#d26)). The app Worker holds one binding (core) and no state; it can be redeployed at any moment with zero risk to anything.

## Three data paths

1. **Request/response** — server functions call core's `AppApi` through the generated typed client over the service binding; TanStack Query owns caching, with query keys per domain aggregate. Mutations (every ceremony, every control) are server functions too — the browser never holds a credential for anything but its own session.
2. **The live feed** — the browser opens a same-origin WebSocket to an app-Worker route; the Access session cookie rides the upgrade, the route validates the Access JWT like any other request ([D27](./00-decisions.md#d27)), and proxies the upgrade to the feed actor. Feed events land in a client store that (a) renders the Activity surfaces and (b) invalidates the affected query keys — the feed is also the cache-invalidation signal, which is what makes the observatory live without polling.
3. **Conversations** — the Workbench's research-agent chat mounts Flue's conversation routes through an app-Worker proxy (session-checked, streamed unbuffered) and renders with `@flue/react`. No Vercel AI SDK anywhere ([D26](./00-decisions.md#d26)).

## The shell

The product's always-present elements ([PRODUCT.md](../PRODUCT.md)) are one layout component fed by one small subscription: system mode + halt-all control, unacknowledged-critical count, override banner, connection indicator, and the mode discipline. Two implementation rules:

- **The halt-all control is a direct server-function call with a confirm — no ceremony, no additional gates** — wired to core's always-available risk-reducing surface ([Cage](./05-cage.md)). It must work when everything else is broken, so it depends on nothing but the binding.
- **Mode discipline is a type, not a style**: every API payload carrying sleeve data carries its mode (`dry-run | live`), the client's domain types preserve it, and the tagged component variants render it — a screen cannot conflate modes without failing to type-check.

## Liveness and honesty

- Every displayed datum carries its **as-of time** from the API, rendered relative and tooltipped absolute. Values the app cannot refresh render as _unknown/stale_, never as their last value pretending to be current.
- The WebSocket's state drives the **connection indicator**: disconnected → visible degraded state, data marked stale, automatic reconnect with backoff; on reconnect the client re-reads the feed cursor from the API — push is an optimization, the record is the truth ([Topology](./02-topology.md)).
- Equity curves and sleeve summaries poll their queries at gentle intervals _while visible_ as a safety net under the feed-driven invalidation; nothing polls when the tab is hidden.

## Auth

Cloudflare Access, in front of everything ([D27](./00-decisions.md#d27)). The concrete shape:

- **One Access application covering the whole subdomain** — never path-scoped, so no sibling route (WebSocket, SSE, server functions) can sit unprotected beside the pages. The subdomain's DNS record is proxied (a Workers custom domain does this automatically); `workers_dev: false` and `preview_urls: false` on the app Worker, so **no route to the app exists that Access doesn't front**.
- **Login**: the Cloudflare identity provider (account members + email match), Independent MFA for passkeys/security keys, one-time PIN kept as the lockout fallback. Global and application sessions set to one month; logout via the Access logout path.
- **The Worker verifies, always**: one early middleware validates the JWT (`cf-access-jwt-assertion` header, falling back to the `CF_Authorization` cookie) against the team JWKS with the app's audience tag, and stashes the identity on request context. Edge enforcement without Worker-side verification is treated as no auth at all.
- **WebSocket**: same-origin upgrades carry the Access cookie automatically — the upgrade is validated like any request, and the feed actor closes the socket at the token's `exp` with a distinct close code so a session can't outlive its authorization. A handshake failure is treated as "possibly expired session," probed over HTTP, never retry-looped.
- **Expired-session UX**: every fetch and server-function call sends `X-Requested-With: XMLHttpRequest`, turning Access's expired-session redirect into a clean **401**; the client responds with a full-page navigation, which lets Access re-authenticate silently while the global session is still valid.
- **Non-browser paths**: service bindings and DO stubs never traverse HTTP, so Access is structurally irrelevant to Worker-to-Worker calls; any future CLI client uses an Access service token under a Service Auth policy, whose JWTs (no email claim) the middleware rejects unless explicitly expected.

Sessions expire; login attempts are in Access's audit logs; there is exactly one operator and no other role.
