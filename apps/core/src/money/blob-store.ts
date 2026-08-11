import type { Sha256 } from "@ironcage/domain";
import { Context, Effect, Layer, Schema } from "effect";

export class MoneyBlobError extends Schema.TaggedError<MoneyBlobError>()("MoneyBlobError", {
  key: Schema.String,
  cause: Schema.Defect(),
}) {}

export class MoneyBlobStore extends Context.Service<
  MoneyBlobStore,
  {
    readonly putImmutable: (input: {
      readonly key: string;
      readonly bytes: Uint8Array;
      readonly digest: Sha256;
      readonly mediaType: string;
    }) => Effect.Effect<void, MoneyBlobError>;
    readonly getText: (key: string) => Effect.Effect<string | null, MoneyBlobError>;
  }
>()("ironcage/core/money/MoneyBlobStore") {
  static layer(bucket: R2Bucket) {
    const verifyExisting = (input: {
      readonly key: string;
      readonly bytes: Uint8Array;
      readonly digest: Sha256;
    }) =>
      Effect.tryPromise({
        try: () => bucket.head(input.key),
        catch: (cause) => new MoneyBlobError({ key: input.key, cause }),
      }).pipe(
        Effect.flatMap((existing) =>
          existing !== null &&
          existing.size === input.bytes.byteLength &&
          existing.customMetadata?.sha256 === input.digest
            ? Effect.succeed(true)
            : existing === null
              ? Effect.succeed(false)
              : Effect.fail(
                  new MoneyBlobError({
                    key: input.key,
                    cause: new Error("immutable object metadata does not match its content"),
                  }),
                ),
        ),
      );

    return Layer.succeed(
      MoneyBlobStore,
      MoneyBlobStore.of({
        putImmutable: Effect.fn("MoneyBlobStore.putImmutable")(function* (input) {
          if (yield* verifyExisting(input)) return;

          const written = yield* Effect.tryPromise({
            try: () =>
              bucket.put(input.key, input.bytes, {
                onlyIf: { etagDoesNotMatch: "*" },
                httpMetadata: { contentType: input.mediaType },
                customMetadata: { sha256: input.digest },
              }),
            catch: (cause) => new MoneyBlobError({ key: input.key, cause }),
          });
          if (written === null && !(yield* verifyExisting(input))) {
            return yield* new MoneyBlobError({
              key: input.key,
              cause: new Error("conditional immutable write did not create an object"),
            });
          }
        }),
        getText: (key) =>
          Effect.tryPromise({
            try: async () => {
              const object = await bucket.get(key);
              return object === null ? null : object.text();
            },
            catch: (cause) => new MoneyBlobError({ key, cause }),
          }),
      }),
    );
  }
}
