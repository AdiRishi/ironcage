import { PgClient } from "@effect/sql-pg";
import { CommandId, EventId } from "@repo/contracts/finance";
import { Crypto, Effect, Schema } from "effect";
import { expect } from "vitest";

import { InterpretationReviews } from "../../src/relationships/reviews.ts";
import { Relationships } from "../../src/relationships/service.ts";
import { applicationTest } from "../support/application.ts";
import { populate } from "../support/populated.ts";

const { test, services } = applicationTest();
const commandId = Crypto.Crypto.use((crypto) => crypto.randomUUIDv4).pipe(
  Effect.map((id) => CommandId.make(id)),
);
const eventId = Effect.fn(function* (description: string) {
  const sql = yield* PgClient.PgClient;
  const [row] =
    yield* sql`SELECT e.id FROM events e JOIN postings p ON p.id = e.primary_posting_id WHERE p.description = ${description}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: EventId })))),
    );
  if (!row) return yield* Effect.die(`Expected ${description}`);
  return row.id;
});

test(
  "an unlinked refund is proposed against its purchase once, and accepting the link resolves it",
  Effect.gen(function* () {
    yield* populate;
    const reviews = yield* InterpretationReviews;
    const refund = yield* eventId("Refund Purchase MYER SYDNEY");
    const purchase = yield* eventId("MYER SYDNEY AU Card xx1234");
    const credits = (yield* reviews.list({})).rows.filter((row) => row.proposal.kind === "credit");
    expect(credits.map((row) => row.eventIds)).toEqual([[refund, purchase]]);
    const [proposal] = credits;
    if (proposal?.proposal.kind !== "credit")
      return yield* Effect.die("Expected a credit proposal");
    expect(proposal.proposal.link.amount.minor).toBe(4000n);

    yield* reviews.propose({ commandId: yield* commandId });
    expect(
      (yield* reviews.list({})).rows.filter((row) => row.proposal.kind === "credit"),
    ).toHaveLength(1);

    const relationships = yield* Relationships;
    const change = { kind: "linkCredit", ...proposal.proposal.link } as const;
    const preview = yield* relationships.preview({ change });
    yield* relationships.apply({
      commandId: yield* commandId,
      change,
      expectedVersions: preview.expectedVersions,
    });
    expect((yield* reviews.list({})).rows.filter((row) => row.proposal.kind === "credit")).toEqual(
      [],
    );
    yield* reviews.propose({ commandId: yield* commandId });
    expect((yield* reviews.list({})).rows.filter((row) => row.proposal.kind === "credit")).toEqual(
      [],
    );
  }).pipe(Effect.provide(services)),
);
