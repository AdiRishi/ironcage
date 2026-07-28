# Workspace Packages Ship Raw TypeScript Source

The `packages/*` workspace packages have no build step — their `exports` maps point straight at `./src/*.ts`, and every consumer (Vite, `tsc`, Wrangler's bundler, Node's type stripping) compiles from source. This follows the throughline/T3 Code starter pattern, kept on purpose: there is no `dist` to go stale against `src`, go-to-definition lands in real source, and package boundaries stay about API shape rather than build artifacts. Do not add build steps to these packages "to do it properly" — the cost would be a compile-watch pipeline and stale-artifact bugs, for zero benefit while the packages are internal-only.

Export granularity is deliberate: `@app/core` is subpath-only (`@app/core/risk/cage`) — no root barrel — so importing one pure function never drags the whole domain into a Worker bundle. `@app/contracts` keeps a root barrel because it is schema-only and consumed wholesale by design.
