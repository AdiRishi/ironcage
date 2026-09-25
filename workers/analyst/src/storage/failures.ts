import { FinanceError } from "@repo/contracts/finance";
import { Effect, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql";

// The object's own SQLite failing, or a stored row that no longer decodes, is a defect.
// The call fails, and a failed alarm runs again.
export const toFinanceError = Effect.catch(
  (
    error: FinanceError | SqlError.SqlError | Schema.SchemaError,
  ): Effect.Effect<never, FinanceError> =>
    Schema.is(FinanceError)(error) ? Effect.fail(error) : Effect.die(error),
);
