import { Schema } from "effect";
import { Model } from "effect/unstable/schema";

/**
 * A point in time. The two boundaries encode it differently and neither choice
 * is ours: node-postgres hands back a `timestamptz` as a JavaScript `Date`,
 * while JSON has no date at all and takes ISO-8601. One field declaration, two
 * codecs, so neither side has to know about the other.
 */
export const Timestamp = Model.Field({
  select: Schema.DateTimeUtcFromDate,
  insert: Schema.DateTimeUtcFromDate,
  update: Schema.DateTimeUtcFromDate,
  json: Schema.DateTimeUtcFromString,
  jsonCreate: Schema.DateTimeUtcFromString,
  jsonUpdate: Schema.DateTimeUtcFromString,
});

/** The ISO-8601 form on its own, for payloads that never touch a row. */
export const Instant = Schema.DateTimeUtcFromString;
export type Instant = typeof Instant.Type;
