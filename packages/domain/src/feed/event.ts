import { Schema } from "effect";

import { uuidV7 } from "../values/uuid";

export const FeedEventId = uuidV7("FeedEventId");
export type FeedEventId = typeof FeedEventId.Type;

export const FeedCursor = Schema.String.check(Schema.isPattern(/^[1-9]\d*$/)).pipe(
  Schema.brand("FeedCursor"),
);
export type FeedCursor = typeof FeedCursor.Type;
