import { intoTaxonomy } from "@ironcage/contracts/client";
import { BoundaryError } from "@ironcage/contracts/schema";
import { Effect, Schema } from "effect";
import type { RpcClientError } from "effect/unstable/rpc";

export const encodedRead = <S extends Schema.Codec<unknown, unknown>>(schema: S) => {
  const encode = Schema.encodeSync(schema);
  return <E, R>(effect: Effect.Effect<S["Type"], E | RpcClientError.RpcClientError, R>) =>
    intoTaxonomy(effect).pipe(Effect.map(encode));
};

const encodeBoundaryError = Schema.encodeSync(BoundaryError);

export const intoOutcome = <S extends Schema.Codec<unknown, unknown>>(schema: S) => {
  const encodeValue = Schema.encodeSync(schema);
  return <E extends BoundaryError, R>(
    effect: Effect.Effect<S["Type"], E | RpcClientError.RpcClientError, R>,
  ) =>
    intoTaxonomy(effect).pipe(
      Effect.map((value) => ({ outcome: "ok", value: encodeValue(value) }) as const),
      Effect.catch((error) =>
        Effect.succeed({ outcome: "error", error: encodeBoundaryError(error) } as const),
      ),
    );
};

export const decodePayload =
  <S extends Schema.Codec<unknown, unknown>>(schema: S) =>
  (input: S["Encoded"]): S["Type"] =>
    Schema.decodeUnknownSync(schema)(input);
