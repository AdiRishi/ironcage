import { Schema } from "effect";

/** Anything not covered by a more specific tag. Retry per policy. */
export class Internal extends Schema.TaggedError<Internal>()(
  "Internal",
  { detail: Schema.String },
  { httpApiStatus: 500 },
) {}

export class ValidationFailed extends Schema.TaggedError<ValidationFailed>()(
  "ValidationFailed",
  { reason: Schema.String, detail: Schema.String },
  { httpApiStatus: 400 },
) {}

export class NotFound extends Schema.TaggedError<NotFound>()(
  "NotFound",
  { entity: Schema.String, id: Schema.String },
  { httpApiStatus: 404 },
) {}

export class Conflict extends Schema.TaggedError<Conflict>()(
  "Conflict",
  { reason: Schema.String, detail: Schema.String },
  { httpApiStatus: 409 },
) {}

export class Stale extends Schema.TaggedError<Stale>()(
  "Stale",
  { reason: Schema.String, detail: Schema.String },
  { httpApiStatus: 409 },
) {}

export const BoundaryError = Schema.Union([ValidationFailed, NotFound, Conflict, Stale, Internal]);
export type BoundaryError = typeof BoundaryError.Type;
