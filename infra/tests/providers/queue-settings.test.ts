import assert from "node:assert/strict";

import * as Effect from "effect/Effect";

import { QueueSettings } from "../../src/providers/queue-settings.ts";
import { DEFAULT_QUEUE_RETENTION_SECONDS } from "../../src/providers/types.ts";
import { queueRetention, test } from "./cloudflare-settings.ts";

test("queue settings return to Cloudflare defaults when removed", (stack) =>
  Effect.gen(function* () {
    yield* stack.deploy(
      QueueSettings("Retention", {
        queueId: "decision-records",
        messageRetentionSeconds: 14 * 24 * 60 * 60,
      }),
    );
    assert.equal(queueRetention.get("decision-records"), 14 * 24 * 60 * 60);

    yield* stack.destroy();
    assert.equal(queueRetention.get("decision-records"), DEFAULT_QUEUE_RETENTION_SECONDS);
  }));
