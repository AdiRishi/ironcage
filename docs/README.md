# Ironcage documentation

Ironcage is a personal wealth operating system: one engine running many investment strategies, each constrained by deterministic risk rules it cannot override, each earning its capital through evidence. AI informs decisions and designs improvements; deterministic code enforces limits; evidence decides what scales.

This page is the front door. Three rules govern the whole set:

1. **The documents form a hierarchy.** [VISION.md](./VISION.md) says why the system exists and states its principles. [PRODUCT.md](./PRODUCT.md) and the product chapters say what it does, observably. [TECHNICAL.md](./TECHNICAL.md) and the technical chapters say how it is built. A lower document that weakens a higher one is wrong and gets fixed — deliberately, with the change recorded.
2. **Chapters are the authority for the current design.** The [decision appendix](./technical/appendix/decisions.md) is an archive of how choices were made and unmade. Read it for history or to avoid re-arguing a settled question — never to find out what the system does. The [ADRs](./adr/) sit outside this hierarchy and describe the repository rather than the system: file layout, build and test wiring, tooling conventions.
3. **Unsettled things are visible.** Proposed values are tagged in each chapter's values table; open questions sit in each chapter's Open questions section with their safe fallbacks. Nothing undecided hides inside a confident adjective.

[STYLE.md](./STYLE.md) is the writing contract every file here follows.

## Reading routes

**New to the project** — read linearly: VISION → PRODUCT → the product chapters in order → TECHNICAL → the technical chapters in order. Chapters open with the context they need and hand off to the next, so the linear read builds.

**Looking something up** — every concept has one home chapter; everything else points at it:

| Topic                                                                       | Home                                                                                |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Workers, bindings, actors, the engine/AI seam                               | [technical/01-architecture](./technical/01-architecture.md)                         |
| Domain objects, lifecycles, invariant ownership, equity accounting, capital | [technical/02-domain](./technical/02-domain.md)                                     |
| Storage tiers, the commit point, schemas, the outbox, retention             | [technical/03-data](./technical/03-data.md)                                         |
| API surfaces, errors, idempotency, the queue contract                       | [technical/04-contracts](./technical/04-contracts.md)                               |
| The tick: gates, strategy, clamp, cage, reservation, persistence            | [technical/05-the-tick](./technical/05-the-tick.md)                                 |
| Venue execution, order ambiguity, stops, reconciliation, simulated fills    | [technical/06-venues](./technical/06-venues.md)                                     |
| AI capabilities: registry, runtime, staleness, scorecards, demotion         | [technical/07-ai](./technical/07-ai.md)                                             |
| Bank evidence, import, deduplication, coverage, categorization, analysis    | [technical/08-money](./technical/08-money.md)                                       |
| The tax engine                                                              | [technical/09-tax](./technical/09-tax.md)                                           |
| Backtests, multiplicity, the gate pipeline, shadow runs                     | [technical/10-workbench](./technical/10-workbench.md)                               |
| The web app: data paths, the live feed protocol, auth                       | [technical/11-app](./technical/11-app.md)                                           |
| Deploys, secrets, testing, vitals, backups, platform assumptions            | [technical/12-operations](./technical/12-operations.md)                             |
| What any surface must show and guarantee                                    | the matching [product chapter](./product/)                                          |
| One trade, traced end to end                                                | [technical/examples/crypto-trend-order](./technical/examples/crypto-trend-order.md) |
| Hand-checked tax computations                                               | [technical/examples/tax-cases](./technical/examples/tax-cases.md)                   |
| Observed CommBank formats and collection runbook                            | [technical/examples/commbank-exports](./technical/examples/commbank-exports.md)     |
| Fictional CommBank parser shapes                                            | [technical/examples/commbank-fixtures](./technical/examples/commbank-fixtures.md)   |
| Build order and dependencies                                                | [ROADMAP.md](./ROADMAP.md)                                                          |
| Repository layout, build and test wiring, tooling conventions               | [adr/](./adr/)                                                                      |
| The ubiquitous language                                                     | [../CONTEXT.md](../CONTEXT.md)                                                      |
