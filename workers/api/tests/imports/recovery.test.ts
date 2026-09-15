import { PgClient } from "@effect/sql-pg";
import { FinanceError, type ImportJob } from "@repo/contracts/finance";
import { Crypto, Effect, Encoding, Layer } from "effect";
import { expect } from "vitest";

import { Publication } from "../../src/imports/publication.ts";
import { Imports } from "../../src/imports/service.ts";
import { Uploads } from "../../src/imports/uploads.ts";
import { ImportJobs, Sources, type WorkflowState } from "../../src/platform/services.ts";
import { Postings } from "../../src/postings/service.ts";
import { applicationTest } from "../support/application.ts";
import { account, parsed, reset, source } from "../support/fixtures.ts";

const { test, services } = applicationTest();
const unexpected = () => Effect.die("The committed upload already has its original bytes.");
const bucket = Layer.succeed(Sources, {
  get: unexpected,
  put: unexpected,
  delete: unexpected,
  createMultipartUpload: unexpected,
});

for (const recovery of ["list", "reupload"] as const)
  test(
    `${recovery} recovers an upload committed before its Workflow was created`,
    Effect.gen(function* () {
      const instances = new Map<string, typeof ImportJob.Type>();
      const jobs = ImportJobs.of({
        start: (input) =>
          Effect.sync(() => {
            if (!instances.has(input.instanceId)) instances.set(input.instanceId, input);
          }),
        status: ({ instanceId }) =>
          instances.has(instanceId)
            ? Effect.succeed({ status: "running", failure: null })
            : Effect.fail(new FinanceError({ kind: "unavailable", message: "Instance not found" })),
      });
      yield* Effect.gen(function* () {
        yield* reset;
        const owner = yield* account();
        const file = yield* source(owner.id);
        const bytes = new TextEncoder().encode("01/09/2026,-4.50,Coffee,");
        const hash = Encoding.encodeHex(
          yield* Crypto.Crypto.use((crypto) => crypto.digest("SHA-256", bytes)),
        );
        const sql = yield* PgClient.PgClient;
        yield* sql`UPDATE source_files SET sha256 = ${hash} WHERE id = ${file.sourceFileId}`;
        yield* sql`UPDATE imports SET workflow_instance_id = ${file.importId} WHERE id = ${file.importId}`;
        const imports = yield* Imports;
        const uploads = yield* Uploads;
        const upload = {
          fileName: "renamed.csv",
          mediaType: "text/csv",
          bytes,
          accountId: owner.id,
        };
        if (recovery === "list") {
          expect((yield* imports.list()).rows[0]?.status).toBe("processing");
        } else {
          expect(yield* uploads.upload(upload)).toEqual({ ...file, existing: true });
        }
        expect((yield* imports.get(file)).status).toBe("processing");
        expect([...instances.values()]).toEqual([
          { importId: file.importId, instanceId: file.importId },
        ]);
        yield* (yield* Publication).publish({ ...parsed(["Coffee"]), importId: file.importId });
        expect((yield* imports.get(file)).status).toBe("complete");
        expect(yield* uploads.upload(upload)).toEqual({ ...file, existing: true });
        expect((yield* (yield* Postings).list({ filter: {} })).rows).toHaveLength(1);
      }).pipe(
        Effect.provide(
          Uploads.layer.pipe(
            Layer.provideMerge(Imports.layer),
            Layer.provideMerge(services),
            Layer.provide([bucket, Layer.succeed(ImportJobs, jobs)]),
          ),
        ),
      );
    }),
  );

test(
  "a Workflow outage preserves readable imports and later recovery uses the saved attempt",
  Effect.gen(function* () {
    let offline = true;
    const instances = new Map<string, WorkflowState>();
    const jobs = ImportJobs.of({
      start: ({ instanceId }) =>
        Effect.gen(function* () {
          if (offline) return yield* new FinanceError({ kind: "unavailable", message: "Offline" });
          if (!instances.has(instanceId))
            instances.set(instanceId, { status: "running", failure: null });
        }),
      status: ({ instanceId }) =>
        Effect.succeed(instances.get(instanceId) ?? { status: "unknown", failure: null }),
    });
    yield* Effect.gen(function* () {
      yield* reset;
      const file = yield* source((yield* account()).id);
      const sql = yield* PgClient.PgClient;
      yield* sql`UPDATE imports SET workflow_instance_id = ${file.importId} WHERE id = ${file.importId}`;
      const imports = yield* Imports;
      const before = yield* imports.get(file);
      expect(before.status).toBe("processing");
      expect((yield* imports.list()).rows).toEqual([before]);
      offline = false;
      expect(yield* imports.get(file)).toEqual(before);
      instances.set(file.importId, { status: "errored", failure: "Execution stopped" });
      const failed = yield* imports.get(file);
      expect(failed.status).toBe("failed");
      expect(failed.failure?.message).toBe("Execution stopped");
    }).pipe(
      Effect.provide(
        Imports.layer.pipe(
          Layer.provideMerge(services),
          Layer.provide(Layer.succeed(ImportJobs, jobs)),
        ),
      ),
    );
  }),
);
