import { mintUuidV7, RequestId } from "@ironcage/domain";
import { Schema } from "effect";

const decodeRequestId = Schema.decodeUnknownSync(RequestId);

export const mintRequestId = () =>
  decodeRequestId(mintUuidV7());
