import { Schema } from "effect";

export const Sha256 = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)).pipe(
  Schema.brand("Sha256"),
);
export type Sha256 = typeof Sha256.Type;
