import { mintUuidV7, uuidV7 } from "./uuid";

export const RequestId = uuidV7("RequestId");
export type RequestId = typeof RequestId.Type;

export const newRequestId = (): RequestId => RequestId.make(mintUuidV7());
