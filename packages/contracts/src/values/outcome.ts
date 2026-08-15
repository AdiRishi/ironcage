import { Schema } from "effect";

import { BoundaryError } from "../surfaces/errors";

export const Outcome = <A, I, R, D>(success: Schema.Codec<A, I, R, D>) =>
  Schema.Union([
    Schema.Struct({ outcome: Schema.Literal("ok"), value: success }),
    Schema.Struct({ outcome: Schema.Literal("error"), error: BoundaryError }),
  ]);
