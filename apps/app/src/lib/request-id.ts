import { RequestId, uuidV7From } from "@ironcage/domain";
import { Schema } from "effect";

const decodeRequestId = Schema.decodeUnknownSync(RequestId);

/**
 * One request ID per operator action, minted here and reused across every retry
 * of that action. Core replays a repeated ID rather than acting twice, so a
 * confirm that times out on the wire is safe to send again — but only while the
 * browser sends the same ID, which is why this is not minted server-side.
 */
export const newRequestId = () =>
  decodeRequestId(uuidV7From(Date.now(), crypto.getRandomValues(new Uint8Array(16))));
