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
  "interpretation and overlapping imports preserve events and exact bank records",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const file = yield* source(owner.id);
    const publication = yield* Publication;
    const input = parsed(["Grocer Card xx1234", "Unknown payment", "Account Fee"]);
    yield* publication.publish({ ...input, importId: file.importId });
    const events = yield* Events;
    const command = {
      commandId: CommandId.make("10000000-0000-4000-8000-000000000001"),
      scope: "all",
    } satisfies Parameters<typeof events.interpret>[0];
    const result = yield* events.interpret(command);
    expect(result.created).toBe(3);
    expect(result.counts).toEqual([
      { role: "financingCost", count: 1 },
      { role: "purchase", count: 1 },
      { role: "unresolved", count: 1 },
    ]);
    expect(yield* events.interpret(command)).toEqual(result);
    const postings = yield* Postings;
    const before = yield* postings.list({ filter: { role: "purchase" } });
    expect(before.rows).toHaveLength(1);
    const posting = before.rows[0];
    if (!posting) return yield* Effect.die("Expected purchase");
    const original = yield* events.forPosting({ postingId: posting.id });
    expect(original?.magnitude.minor).toBe(450n);
    expect(original?.allocations[0]?.amount.minor).toBe(450n);
    const overlap = yield* source(owner.id);
    yield* publication.publish({ ...input, importId: overlap.importId });
    expect(
      (yield* events.interpret({
        ...command,
        commandId: CommandId.make("10000000-0000-4000-8000-000000000002"),
      })).created,
    ).toBe(0);
    expect(yield* events.forPosting({ postingId: posting.id })).toEqual(original);
    expect(
      (yield* postings.list({ filter: { interpretationReview: true } })).rows.map(
        (row) => row.description,
      ),
    ).toEqual(["Unknown payment"]);
  }).pipe(Effect.provide(services)),
);
