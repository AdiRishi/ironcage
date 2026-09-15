import { FinanceError } from "@repo/contracts/finance";
import type { ReadWriteBucketClient } from "alchemy/Cloudflare/R2";
import { Effect, Predicate, Schema } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { SqlError } from "effect/unstable/sql";

export const unavailable = (
  message = "The records service is unavailable. Retry the same request.",
) => new FinanceError({ kind: "unavailable", message });

type StorageFailure =
  | FinanceError
  | SqlError.SqlError
  | Schema.SchemaError
  | PlatformError
  | Effect.Error<ReturnType<ReadWriteBucketClient["get"]>>;

// Storage failures are retryable, a uniqueness violation is a conflict, and anything
// else (such as a stored row that no longer matches its schema) is a defect.
export const toFinanceError = Effect.catch(
  (error: StorageFailure): Effect.Effect<never, FinanceError> => {
    if (Schema.is(FinanceError)(error)) return Effect.fail(error);
    if (Schema.is(SqlError.SqlError)(error))
      return Effect.fail(
        error.reason._tag === "UniqueViolation"
          ? new FinanceError({ kind: "conflict", message: "A matching record already exists." })
          : unavailable(),
      );
    if (Predicate.isTagged(error, "R2Error")) return Effect.fail(unavailable());
    return Effect.die(error);
  },
);
