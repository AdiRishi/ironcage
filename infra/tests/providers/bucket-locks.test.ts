import assert from "node:assert/strict";

import * as Effect from "effect/Effect";

import { BucketLocks } from "../../src/providers/bucket-locks.ts";
import type { BucketLockRule } from "../../src/providers/types.ts";
import { bucketLocks, test } from "./cloudflare-settings.ts";

test("bucket locks replace and clear the complete rule set", (stack) =>
  Effect.gen(function* () {
    const initial: BucketLockRule[] = [
      { id: "indefinite", enabled: true, prefix: "", condition: { type: "Indefinite" } },
      {
        id: "temporary",
        enabled: true,
        prefix: "imports/",
        condition: { type: "Age", maxAgeSeconds: 86_400 },
      },
    ];
    const replacement: BucketLockRule[] = [
      { id: "indefinite", enabled: true, prefix: "", condition: { type: "Indefinite" } },
    ];

    yield* stack.deploy(BucketLocks("Locks", { bucketName: "blobs", rules: initial }));
    assert.deepEqual(bucketLocks.get("blobs"), initial);

    yield* stack.deploy(BucketLocks("Locks", { bucketName: "blobs", rules: replacement }));
    assert.deepEqual(bucketLocks.get("blobs"), replacement);

    yield* stack.destroy();
    assert.deepEqual(bucketLocks.get("blobs"), []);
  }));
