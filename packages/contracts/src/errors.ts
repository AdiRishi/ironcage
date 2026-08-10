import { Schema } from "effect";

/** Anything not covered by a more specific tag. Retry per policy. */
export class Internal extends Schema.TaggedError<Internal>()(
  "Internal",
  { detail: Schema.String },
  { httpApiStatus: 500 },
) {}
