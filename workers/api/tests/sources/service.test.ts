import { PgClient } from "@effect/sql-pg";
import { CommandId } from "@repo/contracts/finance";
import type { ReadWriteBucketClient } from "alchemy/Cloudflare/R2";
import { RuntimeContext } from "alchemy/RuntimeContext";
import { Data, Effect, Layer } from "effect";
import { expect } from "vitest";

import { Publication } from "../../src/imports/publication.ts";
import { Sources } from "../../src/platform/services.ts";
import { Postings } from "../../src/postings/service.ts";
import { SourceFiles } from "../../src/sources/service.ts";
import { applicationTest } from "../support/application.ts";
import { account, parsed, reset, source } from "../support/fixtures.ts";

class StorageFailure extends Data.TaggedError("R2Error")<{ message: string; cause: Error }> {}

const { test, services } = applicationTest();
const unexpected = () => Effect.die("Unexpected storage operation");
const runtime = RuntimeContext.of({
  Type: "Test",
  id: "source-removal",
  env: {},
  get: unexpected,
  set: unexpected,
});

test(
  "retrying an R2 deletion failure uses its receipt key after replacement and retains all evidence",
  Effect.gen(function* () {
    const keys = new Set<string>();
    let fail = true;
    const bucket: ReadWriteBucketClient = {
      raw: unexpected(),
      head: unexpected,
      get: unexpected,
      list: unexpected,
      put: unexpected,
      createMultipartUpload: unexpected,
      resumeMultipartUpload: unexpected,
      delete: (input) =>
        Effect.gen(function* () {
          if (fail)
            return yield* new StorageFailure({
              message: "Injected storage outage",
              cause: new Error("offline"),
            });
          for (const key of Array.isArray(input) ? input : [input]) keys.delete(key);
        }),
    };
    yield* Effect.gen(function* () {
      yield* reset;
      const sql = yield* PgClient.PgClient;
      const file = yield* source((yield* account()).id);
      keys.add(file.sourceFileId);
      yield* Publication.use((publication) =>
        publication.publish({ ...file, ...parsed(["Synthetic purchase"]) }),
      );
      const files = yield* SourceFiles;
      const postings = yield* Postings;
      const before = yield* postings.list({ filter: { importId: file.importId } });
      const input = {
        commandId: CommandId.make(crypto.randomUUID()),
        sourceFileId: file.sourceFileId,
        expectedVersion: 1,
      };
      expect((yield* files.remove(input).pipe(Effect.flip)).kind).toBe("unavailable");
      expect((yield* files.list())[0]?.bytesAvailable).toBe(false);
      expect(keys.has(file.sourceFileId)).toBe(true);
      keys.add("replacement");
      yield* sql`UPDATE source_files SET object_key = 'replacement', bytes_available = true, version = version + 1 WHERE id = ${file.sourceFileId}`;
      fail = false;
      expect(yield* files.remove(input)).toEqual({
        sourceFileId: file.sourceFileId,
        affectedPostingCount: 1,
      });
      expect(keys.has(file.sourceFileId)).toBe(false);
      expect(keys.has("replacement")).toBe(true);
      yield* files.remove(input);
      expect(keys.has("replacement")).toBe(true);
      expect(
        (yield* files
          .remove({ ...input, commandId: CommandId.make(crypto.randomUUID()) })
          .pipe(Effect.flip)).kind,
      ).toBe("stale");
      expect((yield* files.list())[0]).toMatchObject({
        bytesAvailable: true,
        version: 3,
        postingCount: 1,
      });
      expect(yield* postings.list({ filter: { importId: file.importId } })).toEqual(before);
      const posting = before.rows[0];
      if (!posting) return yield* Effect.die("Missing synthetic posting");
      expect((yield* postings.get({ postingId: posting.id })).evidence).toHaveLength(1);
    }).pipe(
      Effect.provide(
        SourceFiles.layer.pipe(
          Layer.provideMerge(services),
          Layer.provide(Layer.succeed(Sources, bucket)),
        ),
      ),
    );
  }).pipe(Effect.provideService(RuntimeContext, runtime)),
);
