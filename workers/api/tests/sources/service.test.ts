import { PgClient } from "@effect/sql-pg";
import { CommandId } from "@repo/contracts/finance";
import { Crypto, Data, Effect, Layer } from "effect";
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

test(
  "retrying an R2 deletion failure uses its receipt key after replacement and retains all evidence",
  Effect.gen(function* () {
    const keys = new Set<string>();
    let fail = true;
    const bucket: Sources["Service"] = {
      get: unexpected,
      put: unexpected,
      createMultipartUpload: unexpected,
      delete: (input) =>
        Effect.gen(function* () {
          if (fail)
            return yield* new StorageFailure({
              message: "Injected storage outage",
              cause: new Error("offline"),
            });
          keys.delete(input);
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
        commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
        sourceFileId: file.sourceFileId,
        expectedVersion: 1,
      };
      expect((yield* files.remove(input).pipe(Effect.flip)).kind).toBe("unavailable");
      expect((yield* files.list)[0]?.bytesAvailable).toBe(false);
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
          .remove({
            ...input,
            commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
          })
          .pipe(Effect.flip)).kind,
      ).toBe("stale");
      expect((yield* files.list)[0]).toMatchObject({
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
  }),
);
