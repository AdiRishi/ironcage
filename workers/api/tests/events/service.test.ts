import { CommandId } from "@repo/contracts/finance";
import { Effect } from "effect";
import { expect } from "vitest";

import { Events } from "../../src/events/service.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Postings } from "../../src/postings/service.ts";
import { applicationTest } from "../support/application.ts";
import { account, parsed, reset, source } from "../support/fixtures.ts";

const { test, services } = applicationTest();
test(
  "publication interprets new postings, and overlapping imports keep events and exact bank records",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const file = yield* source(owner.id);
    const publication = yield* Publication;
    const input = parsed(["Grocer Card xx1234", "Unknown payment", "Account Fee"]);
    yield* publication.publish({ ...input, importId: file.importId });
    const events = yield* Events;
    expect((yield* events.summary).counts).toEqual([
      { role: "financingCost", count: 1 },
      { role: "purchase", count: 1 },
      { role: "unresolved", count: 1 },
    ]);
    const postings = yield* Postings;
    const [purchase] = (yield* postings.list({ filter: { role: "purchase" } })).rows;
    if (!purchase) return yield* Effect.die("Expected purchase");
    const original = yield* events.forPosting({ postingId: purchase.id });
    expect(original).toMatchObject({ kind: "purchase", roleSource: "bank" });
    expect(original?.allocations[0]?.amount.minor).toBe(450n);

    const overlap = yield* source(owner.id);
    yield* publication.publish({ ...input, importId: overlap.importId });
    const command = { commandId: CommandId.make("10000000-0000-4000-8000-000000000001") };
    expect(yield* events.interpret(command)).toEqual({ descriptors: 0, created: 0, changed: 0 });
    expect(yield* events.forPosting({ postingId: purchase.id })).toEqual(original);
    expect(
      (yield* postings.list({ filter: { interpretationReview: true } })).rows.map(
        (row) => row.description,
      ),
    ).toEqual(["Unknown payment"]);
  }).pipe(Effect.provide(services)),
);
