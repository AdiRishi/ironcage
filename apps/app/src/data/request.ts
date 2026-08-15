import { RequestId, uuidV7From } from "@ironcage/domain";
import { Schema } from "effect";

const decodeRequestId = Schema.decodeUnknownSync(RequestId);

export const mintRequestId = () =>
  decodeRequestId(uuidV7From(Date.now(), crypto.getRandomValues(new Uint8Array(16))));
