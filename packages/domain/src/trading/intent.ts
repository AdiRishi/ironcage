import { uuidV7 } from "../values/uuid";

/** Doubles as the venue client-order ID, once a venue fixture accepts the form. */
export const IntentId = uuidV7("IntentId");
export type IntentId = typeof IntentId.Type;
