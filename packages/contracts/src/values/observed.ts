import type { DateTime } from "effect";
import { Schema } from "effect";

export type Observed<A> =
  | {
      readonly _tag: "Fresh";
      readonly value: A;
      readonly asOf: DateTime.Utc;
      readonly staleAfter: DateTime.Utc;
    }
  | { readonly _tag: "Stale"; readonly value: A; readonly asOf: DateTime.Utc }
  | { readonly _tag: "Unknown"; readonly since: DateTime.Utc; readonly reason: string };

export const Observed = <A, I, R, D>(value: Schema.Codec<A, I, R, D>) =>
  Schema.Union([
    Schema.Struct({
      _tag: Schema.Literal("Fresh"),
      value,
      asOf: Schema.DateTimeUtcFromString,
      staleAfter: Schema.DateTimeUtcFromString,
    }),
    Schema.Struct({
      _tag: Schema.Literal("Stale"),
      value,
      asOf: Schema.DateTimeUtcFromString,
    }),
    Schema.Struct({
      _tag: Schema.Literal("Unknown"),
      since: Schema.DateTimeUtcFromString,
      reason: Schema.String,
    }),
  ]);
