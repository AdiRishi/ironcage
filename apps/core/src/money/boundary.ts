import { Conflict, Internal } from "@ironcage/contracts/schema";
import type { RequestId, Sha256 } from "@ironcage/domain";
import { Effect, Schema } from "effect";

import type { StoredRequest } from "../persistence";

export type MoneyBoundaryError = import("@ironcage/contracts/schema").BoundaryError;

export const infrastructureError = (error: {
  readonly _tag: string;
  readonly operation?: string;
}) => new Internal({ detail: error.operation ?? error._tag });

export const decodeStored = <A>(
  schema: Schema.Decoder<A>,
  value: unknown,
  entity: string,
): Effect.Effect<A, Internal> =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(() => new Internal({ detail: `stored ${entity} failed schema decoding` })),
  );

export const replayRequest = <A>(input: {
  readonly requests: readonly StoredRequest[];
  readonly requestId: RequestId;
  readonly operation: string;
  readonly payloadHash: Sha256;
  readonly schema: Schema.Decoder<A>;
}): Effect.Effect<A | null, Conflict | Internal> => {
  const previous = input.requests.find((request) => request.requestId === input.requestId);
  if (previous === undefined) return Effect.succeed(null);

  if (previous.operation !== input.operation || previous.payloadHash !== input.payloadHash) {
    return Effect.fail(
      new Conflict({
        reason: "RequestIdCollision",
        detail: `${input.requestId} was already used with different content`,
      }),
    );
  }

  return decodeStored(input.schema, previous.response, input.operation);
};
