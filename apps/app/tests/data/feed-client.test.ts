import { FeedCursor } from "@ironcage/domain";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { createFeedCursorStore } from "@/data/feed-client";

const cursor = Schema.decodeUnknownSync(FeedCursor);

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
};

describe("feed cursor store", () => {
  it("advances monotonically so replayed events are not applied twice", () => {
    const store = createFeedCursorStore(memoryStorage());

    expect(store.advance(cursor("12"))).toBe(true);
    expect(store.advance(cursor("12"))).toBe(false);
    expect(store.advance(cursor("9"))).toBe(false);
    expect(store.advance(cursor("13"))).toBe(true);
    expect(store.read()).toBe("13");
  });

  it("discards a corrupt browser cursor instead of breaking subscription", () => {
    const storage = memoryStorage();
    storage.setItem("ironcage.feed.cursor", "not-a-cursor");

    expect(createFeedCursorStore(storage).read()).toBeNull();
    expect(storage.getItem("ironcage.feed.cursor")).toBeNull();
  });
});
