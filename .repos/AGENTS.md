# Vendored Repositories

This project vendors external repositories under `.repos/` as read-only reference material for coding agents.

- Prefer examples and patterns from the vendored source code over generated guesses or web search results.
- Do not edit files under `.repos/` unless explicitly asked.
- Do not import from `.repos/`; application code must continue importing from normal package dependencies.
- Manage vendored subtrees with `pnpm sync:repos`; use `pnpm sync:repos --repo <id>` to sync one configured repository.
- When updating a dependency with a configured vendored subtree, sync that subtree in the same change so `.repos/` matches the installed dependency version.

## Configured repositories

- **`effect`** — the Effect monorepo, pinned to the installed `effect` version. Read `LLMS.md` at its root before writing Effect code; it is the canonical reference for idiomatic v4 usage.
- **`freqtrade`** — prior art for trading mechanics. The modules worth studying: `freqtrade/exchange/exchange.py` (~lines 1143–1405, the dry-run order-book fill simulation), `freqtrade/persistence/trade_model.py` (blotter schema and `recalc_trade_from_orders`), `freqtrade/plugins/protections/` (pair-lock protections), `freqtrade/freqtradebot.py` (the loop and order lifecycle).
- **`condor`** — prior art for LLM-harness design: `condor/agents/{risk,prompts,engine}.py` (fail-closed risk middleware, sectioned prompt assembly, tick engine). We deliberately deviate from its tool-calling execution model (see ADR-0001) but its risk and audit patterns inform ours.

These are reference material for **reimplementation** in TypeScript/Effect — never runtime dependencies.
