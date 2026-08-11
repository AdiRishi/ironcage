import { BoundaryError } from "@ironcage/contracts/schema";
import { Schema } from "effect";

import type { CoreOutcome } from "@/server/money";

export type BoundaryFailure = typeof BoundaryError.Type;

const decodeError = Schema.decodeSync(BoundaryError);

/**
 * A failure the operator is meant to read, carried as an error React Query can
 * hold. Rendering reaches for `boundaryFailure` rather than stringifying,
 * because "the transaction record changed after preview" is an instruction and
 * `[object Object]` is not.
 */
export class CoreCallFailed extends Error {
  readonly failure: BoundaryFailure;

  constructor(failure: BoundaryFailure) {
    super(failure._tag);
    this.name = "CoreCallFailed";
    this.failure = failure;
  }
}

export const boundaryFailure = (error: unknown) =>
  error instanceof CoreCallFailed ? error.failure : null;

/** Unwraps a server function's outcome, decoding both sides with their schema. */
export const unwrap =
  <A, I>(schema: Schema.Codec<A, I>) =>
  (outcome: CoreOutcome<I>): A => {
    if (!outcome.ok) throw new CoreCallFailed(decodeError(outcome.error));

    return Schema.decodeSync(schema)(outcome.value);
  };

/** Nothing on these surfaces is safety-critical, so none of it polls. */
export const readStaleTime = 30_000;
