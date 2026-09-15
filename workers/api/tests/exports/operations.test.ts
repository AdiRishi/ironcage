import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { CommandId, FinanceError } from "@repo/contracts/finance";
import { Crypto, Effect, Layer } from "effect";
import { expect } from "vitest";

import { Exports } from "../../src/exports/service.ts";
import { ExportJobs, Sources, TemporaryExports } from "../../src/platform/services.ts";
import { applicationTest } from "../support/application.ts";

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
