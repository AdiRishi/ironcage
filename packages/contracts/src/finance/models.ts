import { Schema } from "effect";

import { Instant, Money } from "./values.ts";

export const ModelUsage = Schema.Struct({
  calls: Schema.Int,
  inputTokens: Schema.BigIntFromString,
  outputTokens: Schema.BigIntFromString,
  unknownUsage: Schema.Int,
  costs: Schema.Array(Money),
  recent: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      task: Schema.String,
      model: Schema.String,
      occurredAt: Instant,
      inputTokens: Schema.NullOr(Schema.BigIntFromString),
      outputTokens: Schema.NullOr(Schema.BigIntFromString),
      cost: Schema.NullOr(Money),
      status: Schema.Literals(["success", "failed"]),
    }),
  ),
});
