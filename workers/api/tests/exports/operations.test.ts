import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { PgClient } from "@effect/sql-pg";
import { CommandId, ExportId, FinanceError } from "@repo/contracts/finance";
import { Crypto, Effect, Layer } from "effect";
import { expect } from "vitest";

import { Exports } from "../../src/exports/service.ts";
import { ExportJobs, Sources, TemporaryExports } from "../../src/platform/services.ts";
import { applicationTest } from "../support/application.ts";
import { reset } from "../support/fixtures.ts";

const { test, services } = applicationTest();
const unexpected = () => Effect.die("Unexpected storage access before export generation");
const bucket: Sources["Service"] = {
  get: unexpected,
  put: unexpected,
  delete: unexpected,
  createMultipartUpload: unexpected,
};

test(
  "a failed export remains visible and a new command can request it again without duplicating a lost response",
  Effect.gen(function* () {
    let unavailable = true;
    const jobs = ExportJobs.of({
      start: () =>
        unavailable
          ? Effect.fail(new FinanceError({ kind: "unavailable", message: "Workflow unavailable" }))
          : Effect.void,
      status: () => Effect.succeed({ status: "running", failure: null }),
    });
    yield* Effect.gen(function* () {
      const exports = yield* Exports;
      const input = {
        commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
        includeSources: false,
      };
      const failed = yield* exports.request(input);
      expect(failed.status).toBe("failed");
      unavailable = false;
      const nextInput = {
        ...input,
        commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
      };
      const next = yield* exports.request(nextInput);
      expect(next.status).toBe("processing");
      expect(next.id).not.toBe(failed.id);
      expect((yield* exports.request(nextInput)).id).toBe(next.id);
      expect((yield* exports.request(input)).status).toBe("failed");
      expect((yield* exports.list).length).toBe(2);
      expect(
        (yield* exports.request({ ...input, includeSources: true }).pipe(Effect.flip)).kind,
      ).toBe("conflict");
    }).pipe(
      Effect.provide(
        Exports.layer.pipe(
          Layer.provideMerge(services),
          Layer.provide(NodeCrypto.layer),
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(ExportJobs, jobs),
              Layer.succeed(Sources, bucket),
              Layer.succeed(TemporaryExports, bucket),
            ),
          ),
        ),
      ),
    );
  }),
);

test(
  "listing a committed export starts its missing Workflow without creating another export",
  Effect.gen(function* () {
    const instances = new Set<string>();
    const jobs = ExportJobs.of({
      start: ({ exportId }) =>
        Effect.sync(() => {
          instances.add(exportId);
        }),
      status: ({ instanceId }) =>
        instances.has(instanceId)
          ? Effect.succeed({ status: "running", failure: null })
          : Effect.fail(new FinanceError({ kind: "unavailable", message: "Instance not found" })),
    });
    yield* Effect.gen(function* () {
      yield* reset;
      const exportId = ExportId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4));
      const sql = yield* PgClient.PgClient;
      yield* sql`INSERT INTO exports (id, status, include_sources) VALUES (${exportId}, 'processing', false)`;
      const exports = yield* Exports;
      const rows = yield* exports.list;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: exportId, status: "processing" });
      expect(yield* exports.get({ exportId })).toEqual(rows[0]);
      expect([...instances]).toEqual([exportId]);
    }).pipe(
      Effect.provide(
        Exports.layer.pipe(
          Layer.provideMerge(services),
          Layer.provide(NodeCrypto.layer),
          Layer.provide([
            Layer.succeed(ExportJobs, jobs),
            Layer.succeed(Sources, bucket),
            Layer.succeed(TemporaryExports, bucket),
          ]),
        ),
      ),
    );
  }),
);
