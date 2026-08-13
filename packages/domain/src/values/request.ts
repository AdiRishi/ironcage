import { uuidV7 } from "./uuid";

export const RequestId = uuidV7("RequestId");
export type RequestId = typeof RequestId.Type;
