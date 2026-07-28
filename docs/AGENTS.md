# Docs

Durable documentation for this repository. Code comments explain a file; the documents here explain the system.

- **[`VISION.md`](./VISION.md)** — why Ironcage exists, the evidence base, and the binding principles. Highest precedence: where documents conflict, the vision wins.
- **[`PRODUCT.md`](./PRODUCT.md)** — what the system does: surfaces, modes, guarantees, and the milestone ladder.
- **[`TECHNICAL.md`](./TECHNICAL.md)** — how it's built: architecture, domain model, platform mapping, testing strategy. Where it conflicts with the vision or product docs, they win.
- **[`adr/`](./adr/AGENTS.md)** — Architecture Decision Records: why the hard-to-reverse decisions were made. Start here to understand anything in the codebase that looks surprising.
- **`plans/`** — implementation plans for coordinated initiatives (created when the first plan is needed; plans say _what we intend to build_, ADRs say _why a decision was made_).
- **`../.repos/`** — vendored read-only reference repositories, managed by `pnpm sync:repos`.

As the product and technical surfaces grow, split them into `product/` and `technical/` subdirectories with the top-level file as the map — follow the numbering-and-map pattern rather than letting the top-level files bloat.
