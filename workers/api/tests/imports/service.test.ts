import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { PgClient } from "@effect/sql-pg";
import { CommandId, FinanceError, ImportId } from "@repo/contracts/finance";
import { Crypto, Effect } from "effect";
import { Layer } from "effect";
import { expect } from "vitest";

import { Imports } from "../../src/imports/service.ts";
import { ImportJobs } from "../../src/platform/services.ts";
import { applicationTest } from "../support/application.ts";
import { account, reset, source } from "../support/fixtures.ts";

const { test, services } = applicationTest();
// Imports over the test services, with Workflow status from `status`.
const importsWith = (status: (typeof ImportJobs.Service)["status"]) =>
  Imports.layer.pipe(
    Layer.provide(Layer.succeed(ImportJobs, { start: () => Effect.void, status })),
    Layer.provideMerge(services),
    Layer.provide(NodeCrypto.layer),
  );

test(
  "a stale retry is rejected even when Workflow status is unavailable",
  Effect.gen(function* () {
    yield* reset;
    const sql = yield* PgClient.PgClient;
    const file = yield* source((yield* account()).id);
    yield* sql`UPDATE imports SET workflow_instance_id = 'running', version = 2 WHERE id = ${file.importId}`;
    const imports = yield* Imports;
    const error = yield* imports
      .retry({
        importId: file.importId,
        commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
        expectedVersion: 1,
      })
      .pipe(Effect.flip);
    expect(error.kind).toBe("stale");
  }).pipe(
    Effect.provide(
      importsWith(() =>
        Effect.fail(new FinanceError({ kind: "unavailable", message: "Workflow unavailable" })),
      ),
    ),
  ),
);

test(
  "retrying a lost response keeps one attempt and ignores an older attempt's failure",
  Effect.gen(function* () {
    yield* reset;
    const sql = yield* PgClient.PgClient;
    const owner = yield* account();
    const file = yield* source(owner.id);
    yield* sql`UPDATE imports SET status = 'failed', workflow_instance_id = 'old' WHERE id = ${file.importId}`;
    const imports = yield* Imports;
    const item = yield* imports.get(file);
    const input = {
      ...file,
      commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
      expectedVersion: item.version,
    };
    const first = yield* imports.retry(input);
    expect(first.status).toBe("processing");
    expect(yield* imports.retry(input)).toEqual(first);
    yield* imports.fail({
      importId: file.importId,
      instanceId: "old",
      failure: { message: "Late failure" },
    });
    expect((yield* imports.get(file)).status).toBe("processing");
    const stale = yield* imports
      .retry({
        ...input,
        commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
      })
      .pipe(Effect.flip);
    expect(stale.kind).toBe("stale");
    expect(yield* imports.get(file)).toEqual(first);
  }).pipe(Effect.provide(importsWith(() => Effect.succeed({ status: "running", failure: null })))),
);

test(
  "an import the API does not have is not found, so its address shows no page",
  Effect.gen(function* () {
    yield* reset;
    const error = yield* (yield* Imports)
      .get({ importId: ImportId.make("00000000-0000-4000-8000-000000000001") })
      .pipe(Effect.flip);
    expect(error.kind).toBe("notFound");
  }).pipe(Effect.provide(importsWith(() => Effect.succeed({ status: "running", failure: null })))),
);

test(
  "a workflow that died before reporting becomes a visible failed import",
  Effect.gen(function* () {
    yield* reset;
    const sql = yield* PgClient.PgClient;
    const file = yield* source((yield* account()).id);
    yield* sql`UPDATE imports SET workflow_instance_id = 'stopped' WHERE id = ${file.importId}`;
    const imports = yield* Imports;
    const result = yield* imports.get(file);
    expect(result.status).toBe("failed");
    expect(result.failure?.message).toBe("Execution limit exceeded");
  }).pipe(
    Effect.provide(
      importsWith(() => Effect.succeed({ status: "errored", failure: "Execution limit exceeded" })),
    ),
  ),
);
