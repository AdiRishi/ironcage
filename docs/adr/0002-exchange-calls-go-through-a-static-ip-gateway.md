# Exchange Calls Go Through a Static-IP Gateway

All authenticated venue traffic goes Worker → Cloudflare Tunnel → a thin gateway service on a cheap static-IP VPS → the venue. The gateway signs requests with keys that exist only there, forwards them, normalizes responses, and enforces nothing.

This is forced, not chosen: Cloudflare Workers egress IPs are unpublished, shared, and rotating, so venue API keys can never be IP-allowlisted from Workers — and IP-locked, withdrawal-disabled keys are the strongest security control available (Kraken supports key IP restriction; for Alpaca, confining the key to one machine is the compensating control). Smart Placement and Containers solve neither problem. The deliberate consequence: if the gateway is down, nothing can trade — the failure mode we want. Public market data may still be fetched directly from Workers where venues allow it; only authenticated calls are bound to this path.
