import {
  AcknowledgeInput,
  FeedEventView,
  FeedPage,
  GetFeedInput,
} from "@ironcage/contracts/schema";
import { createServerFn } from "@tanstack/react-start";

import { decodePayload, encodedRead, intoOutcome } from "@/server/boundary";
import { callCore } from "@/server/core";

export const getFeed = createServerFn()
  .validator(decodePayload(GetFeedInput))
  .handler(({ data }) => callCore((client) => encodedRead(FeedPage)(client.getFeed(data))));

export const acknowledge = createServerFn({ method: "POST" })
  .validator(decodePayload(AcknowledgeInput))
  .handler(({ data }) =>
    callCore((client) => intoOutcome(FeedEventView)(client.acknowledge(data))),
  );
