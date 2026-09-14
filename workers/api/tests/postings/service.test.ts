import { Effect } from "effect";
import { expect } from "vitest";

import { Publication } from "../../src/imports/publication.ts";
import { Postings } from "../../src/postings/service.ts";
import { applicationTest } from "../support/application.ts";
import { account, parsed, reset, source } from "../support/fixtures.ts";

const { test, services } = applicationTest();
test(
  "transaction cursors do not skip same-day purchases and filters retain exact signs",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const file = yield* source(owner.id);
    const publication = yield* Publication;
    yield* publication.publish({
      ...parsed(Array.from({ length: 55 }, (_, index) => `Purchase ${index}`)),
      importId: file.importId,
    });
    const postings = yield* Postings;
    const first = yield* postings.list({ filter: { accountId: owner.id } });
    expect(first.rows).toHaveLength(50);
    if (!first.nextCursor) return yield* Effect.die("Expected the next page");
    const second = yield* postings.list({
      filter: { accountId: owner.id },
      cursor: first.nextCursor,
    });
    expect(second.rows).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(55);
    const filtered = yield* postings.list({
      filter: { currency: "AUD", minimum: "-450", maximum: "-450", description: "Purchase 54" },
    });
    expect(filtered.rows.map((row) => row.description)).toEqual(["Purchase 54"]);
    expect((yield* postings.list({ filter: { minimum: "0" } })).rows).toHaveLength(0);
    expect((yield* postings.list({ filter: { currency: "USD" } })).rows).toHaveLength(0);
  }).pipe(Effect.provide(services)),
);
