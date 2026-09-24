import { PgClient } from "@effect/sql-pg";
import { CommandId } from "@repo/contracts/finance";
import { descriptorProfiles } from "@repo/finance";
import { Crypto, Effect } from "effect";
import { expect } from "vitest";

import { Events } from "../../src/events/service.ts";
import { Publication } from "../../src/imports/publication.ts";
import { applicationTest } from "../support/application.ts";
import { account, parsed, reset, source } from "../support/fixtures.ts";

const { test, services } = applicationTest();

test(
  "descriptors read by an older version of their bank's profile are read again",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const file = yield* source(owner.id);
    yield* (yield* Publication).publish({
      ...parsed(["WOOLWORTHS 1234 SYDNEY AU Card xx1234"]),
      importId: file.importId,
    });
    const sql = yield* PgClient.PgClient;
    const current = descriptorProfiles.commbank.version;
    const read = sql`SELECT profile, profile_version AS version, alias_key AS "aliasKey" FROM posting_descriptors`;
    expect(yield* read).toEqual([
      { profile: "commbank", version: current, aliasKey: "WOOLWORTHS SYDNEY" },
    ]);
    yield* sql`UPDATE posting_descriptors SET profile_version = 0, alias_key = NULL`;
    const summary = yield* (yield* Events).interpret({
      commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
    });
    expect(summary.descriptors).toBe(1);
    expect(yield* read).toEqual([
      { profile: "commbank", version: current, aliasKey: "WOOLWORTHS SYDNEY" },
    ]);
  }).pipe(Effect.provide(services)),
);
