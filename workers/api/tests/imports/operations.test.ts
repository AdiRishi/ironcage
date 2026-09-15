import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { PgClient } from "@effect/sql-pg";
import { CommandId } from "@repo/contracts/finance";
import { Crypto, Effect } from "effect";
import { Layer } from "effect";
import { expect } from "vitest";

import { Imports } from "../../src/imports/operations.ts";
import { ImportRepository } from "../../src/imports/repository.ts";
import { ImportJobs } from "../../src/platform/services.ts";
import { applicationTest } from "../support/application.ts";
import { account, reset, source } from "../support/fixtures.ts";

const { test, services } = applicationTest();
test(
  "retrying a lost response keeps one attempt and ignores an older attempt's failure",
  Effect.gen(function* () {
    yield* reset;
    const sql = yield* PgClient.PgClient;
    const owner = yield* account();
    const file = yield* source(owner.id);
    yield* sql`UPDATE imports SET status = 'failed', workflow_instance_id = 'old' WHERE id = ${file.importId}`;
    const imports = yield* Imports;
    const repository = yield* ImportRepository;
    const item = yield* repository.get(file);
    const input = {
      ...file,
      commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
      expectedVersion: item.version,
    };
    const first = yield* imports.retry(input);
    expect(first.status).toBe("processing");
    expect(yield* imports.retry(input)).toEqual(first);
    yield* repository.fail({
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
    expect(yield* repository.get(file)).toEqual(first);
  }).pipe(
    Effect.provide(
      Imports.layer.pipe(
        Layer.provideMerge(ImportRepository.layer),
        Layer.provide(
          Layer.succeed(ImportJobs, {
            start: () => Effect.void,
            status: () => Effect.succeed({ status: "running", failure: null }),
          }),
        ),
        Layer.provideMerge(services),
        Layer.provide(NodeCrypto.layer),
      ),
    ),
  ),
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
      Imports.layer.pipe(
        Layer.provideMerge(ImportRepository.layer),
        Layer.provide(
          Layer.succeed(ImportJobs, {
            start: () => Effect.void,
            status: () =>
              Effect.succeed({ status: "errored", failure: "Execution limit exceeded" }),
          }),
        ),
        Layer.provideMerge(services),
        Layer.provide(NodeCrypto.layer),
      ),
    ),
  ),
);
