import type { RequestId, Sha256 } from "@ironcage/domain";
import { Schema } from "effect";

export class PersistenceError extends Schema.TaggedError<PersistenceError>()("PersistenceError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export interface StoredRequest {
  readonly requestId: RequestId;
  readonly operation: string;
  readonly payloadHash: Sha256;
  readonly response: unknown;
}
