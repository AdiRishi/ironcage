# Ironcage — Technical Specification

The [vision](./VISION.md) says why Ironcage exists. The [product specification](./PRODUCT.md) says what it does. This specification says how it is built. A technical choice that cannot honor a product guarantee is wrong, and the fix is to change the technical choice or to deliberately revise the product — never to let the two drift apart silently.

The test of this specification: a competent engineer should be able to read it and build the system without asking what was meant. Each chapter opens with what it guarantees and closes with the values it sets, the alternatives it rejected, its open questions, and a build checklist. A chapter with an unmet checklist is unfinished, and says so.

## The chapters

Read them in order for the whole system, or jump by subject — each chapter stands on its own.

| #   | Chapter                                        | The question it answers                                               |
| --- | ---------------------------------------------- | --------------------------------------------------------------------- |
| 01  | [Architecture](./technical/01-architecture.md) | What are the components, and who may talk to whom?                    |
| 02  | [Domain](./technical/02-domain.md)             | What are the objects, their lifecycles, and who owns each invariant?  |
| 03  | [Data](./technical/03-data.md)                 | What is stored where, in what shape, and what commits together?       |
| 04  | [Contracts](./technical/04-contracts.md)       | What crosses every boundary, and how do calls fail?                   |
| 05  | [The tick](./technical/05-the-tick.md)         | How does one trading decision happen, from alarm to persisted intent? |
| 06  | [Venues](./technical/06-venues.md)             | How do we talk to Kraken and Alpaca without ever double-ordering?     |
| 07  | [AI](./technical/07-ai.md)                     | How does AI participate without ever touching the order path?         |
| 08  | [Money](./technical/08-money.md)               | How does bank history get imported, deduplicated, and understood?     |
| 09  | [Tax](./technical/09-tax.md)                   | How does every source become one verified Australian tax picture?     |
| 10  | [Workbench](./technical/10-workbench.md)       | How are strategies tested, and how do proposals earn their way in?    |
| 11  | [App](./technical/11-app.md)                   | How does the observatory render, update live, and authenticate?       |
| 12  | [Operations](./technical/12-operations.md)     | How is the system developed, deployed, tested, and kept honest?       |

Supporting material:

- [examples/crypto-trend-order.md](./technical/examples/crypto-trend-order.md) — one fixed trade threaded through chapters 05–07; the integration test replays it.
- [examples/tax-cases.md](./technical/examples/tax-cases.md) — hand-computed tax scenarios that double as golden test fixtures.
- [appendix/decisions.md](./technical/appendix/decisions.md) — the decision archive: history, supersessions, and rejected alternatives. You never need it to build the system; you need it to avoid re-arguing settled questions.
- [ROADMAP.md](./ROADMAP.md) — the build order (Money → Tax → the investing engine) and the dependency map.

## The stack

| Layer                   | Choice                                                                   | Specified in                                   |
| ----------------------- | ------------------------------------------------------------------------ | ---------------------------------------------- |
| Language & core library | TypeScript with Effect V4 (pinned beta; vendored source is ground truth) | [Architecture](./technical/01-architecture.md) |
| Runtime platform        | Cloudflare: Workers, Durable Objects, Workflows, Queues, Containers, R2  | [Architecture](./technical/01-architecture.md) |
| System of record        | PlanetScale Postgres via dual Hyperdrive bindings                        | [Data](./technical/03-data.md)                 |
| AI framework & routing  | Flue for all AI code; AI Gateway for all model traffic                   | [AI](./technical/07-ai.md)                     |
| Durable pipelines       | Cloudflare Workflows, Effect inside each step                            | [Workbench](./technical/10-workbench.md)       |
| Web application         | TanStack Start, shadcn/ui, behind Cloudflare Access                      | [App](./technical/11-app.md)                   |
| Venues                  | Kraken (crypto spot) and Alpaca (US stocks/ETFs)                         | [Venues](./technical/06-venues.md)             |

Status: this specification is actively worked. Where a chapter is silent, raise the question rather than assuming. Values tagged _proposed_ are defaults awaiting the operator's veto, and each chapter's Open questions section is the honest list of what is not yet decided.
