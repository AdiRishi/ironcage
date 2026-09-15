import { FinanceError } from "@repo/contracts/finance";
import { Effect, Exit, Stream } from "effect";
import { Zip, ZipDeflate } from "fflate";

import type { TemporaryExports } from "../platform/services.ts";

export interface ArchiveEntry {
  readonly path: string;
  readonly body: Stream.Stream<Uint8Array, FinanceError>;
}
const archiveFailure = () =>
  new FinanceError({
    kind: "unavailable",
    message: "The export could not be written. Request a new export.",
  });

export const archiveStream = (entries: ReadonlyArray<ArchiveEntry>) =>
  Stream.suspend(() => {
    const chunks: Uint8Array[] = [];
    let failure: Error | undefined;
    const zip = new Zip((error, data) => {
      if (error) failure = error;
      else chunks.push(data);
    });
    const drain = () =>
      failure ? Effect.fail(archiveFailure()) : Effect.succeed(chunks.splice(0));
    return Stream.fromIterable(entries).pipe(
      Stream.flatMap((entry) =>
        Stream.suspend(() => {
          const file = new ZipDeflate(entry.path, { level: 1 });
          zip.add(file);
          return entry.body.pipe(
            Stream.filter((chunk) => chunk.length > 0),
            Stream.concat(Stream.succeed(new Uint8Array())),
            Stream.mapEffect((chunk) =>
              Effect.gen(function* () {
                file.push(chunk, chunk.length === 0);
                return yield* drain();
              }),
            ),
            Stream.flattenIterable,
          );
        }),
      ),
      Stream.concat(
        Stream.fromEffect(
          Effect.gen(function* () {
            zip.end();
            return yield* drain();
          }),
        ).pipe(Stream.flattenIterable),
      ),
    );
  });

export const writeArchive = Effect.fn("Exports.writeArchive")(function* (
  bucket: Pick<TemporaryExports["Service"], "createMultipartUpload">,
  key: string,
  entries: ReadonlyArray<ArchiveEntry>,
) {
  yield* Effect.acquireUseRelease(
    bucket.createMultipartUpload(key, {
      httpMetadata: { contentType: "application/zip" },
    }),
    Effect.fnUntraced(function* (upload) {
      const parts: Array<Effect.Success<ReturnType<typeof upload.uploadPart>>> = [];
      const buffer = new Uint8Array(5 * 1024 * 1024);
      let length = 0;
      const flush = Effect.fn(function* () {
        parts.push(yield* upload.uploadPart(parts.length + 1, buffer.subarray(0, length)));
        length = 0;
      });
      yield* archiveStream(entries).pipe(
        Stream.runForEach((chunk) =>
          Effect.gen(function* () {
            let offset = 0;
            while (offset < chunk.length) {
              const count = Math.min(buffer.length - length, chunk.length - offset);
              buffer.set(chunk.subarray(offset, offset + count), length);
              length += count;
              offset += count;
              if (length === buffer.length) yield* flush();
            }
          }),
        ),
      );
      if (length > 0) yield* flush();
      yield* upload.complete(parts);
    }),
    (upload, exit) => (Exit.isFailure(exit) ? upload.abort().pipe(Effect.ignore) : Effect.void),
  );
}, Effect.mapError(archiveFailure));

export const textEntry = (path: string, text: string): ArchiveEntry => ({
  path,
  body: Stream.suspend(() =>
    Stream.fromIterable(
      (function* () {
        const encoder = new TextEncoder();
        // The u flag keeps surrogate pairs intact so no chunk splits a character.
        for (const [chunk] of text.matchAll(/.{1,32768}/gsu)) {
          yield encoder.encode(chunk);
        }
      })(),
    ),
  ),
});
