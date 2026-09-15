import { it } from "@effect/vitest";
import { FinanceError } from "@repo/contracts/finance";
import { Deferred, Effect, Exit, Fiber, Ref, Stream } from "effect";
import { expect } from "vitest";

import { writeArchive } from "../../src/exports/archive.ts";
import type { TemporaryExports } from "../../src/platform/services.ts";

type MultipartUpload = Effect.Success<
  ReturnType<TemporaryExports["Service"]["createMultipartUpload"]>
>;

const multipartUpload = Effect.gen(function* () {
  const active = yield* Ref.make(true);
  const upload: MultipartUpload = {
    key: "exports/test.zip",
    uploadId: "test-upload",
    get raw(): never {
      throw new Error("Unexpected native R2 access");
    },
    uploadPart: () => Effect.die("Unexpected upload of an incomplete archive"),
    complete: () => Effect.die("Unexpected completion of an incomplete archive"),
    abort: () => Ref.set(active, false),
  };
  return { active, upload };
});

it.effect("a source read failure aborts the unfinished export", () =>
  Effect.gen(function* () {
    const { active, upload } = yield* multipartUpload;
    const error = yield* writeArchive(
      { createMultipartUpload: () => Effect.succeed(upload) },
      upload.key,
      [
        {
          path: "sources/test",
          body: Stream.fail(
            new FinanceError({ kind: "unavailable", message: "Source unavailable" }),
          ),
        },
      ],
    ).pipe(Effect.flip);
    expect(error.kind).toBe("unavailable");
    expect(yield* Ref.get(active)).toBe(false);
  }),
);

it.effect("cancellation during multipart creation still releases the acquired upload", () =>
  Effect.gen(function* () {
    const { active, upload } = yield* multipartUpload;
    const started = yield* Deferred.make<void>();
    const response = yield* Deferred.make<void>();
    const fiber = yield* writeArchive(
      {
        createMultipartUpload: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(response);
            return upload;
          }),
      },
      upload.key,
      [{ path: "sources/test", body: Stream.never }],
    ).pipe(Effect.forkChild);
    yield* Deferred.await(started);
    const interruption = yield* Fiber.interrupt(fiber).pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    yield* Deferred.succeed(response, undefined);
    yield* Fiber.join(interruption);
    expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true);
    expect(yield* Ref.get(active)).toBe(false);
  }),
);
