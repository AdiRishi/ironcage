import { FeedEventView } from "@ironcage/contracts/schema";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { invalidationsFor } from "@/data/invalidation";

const event = (eventType: string, category = "system") =>
  Schema.decodeUnknownSync(FeedEventView)({
    id: "01910000-0000-7000-8000-000000000001",
    cursor: "1",
    occurredAt: "2032-01-01T00:00:00.000Z",
    origin: "test",
    category,
    eventType,
    severity: "info",
    summary: "test event",
    payload: {},
    links: null,
    acknowledgedAt: null,
  });

describe("feed invalidation", () => {
  it("always refreshes the feed and system status", () => {
    expect(invalidationsFor(event("system_event"))).toEqual([["feed"], ["system"]]);
  });

  it("refreshes every view affected by a completed money import", () => {
    expect(invalidationsFor(event("bank_import_completed", "money_tax"))).toEqual([
      ["feed"],
      ["system"],
      ["money"],
      ["wealth"],
    ]);
  });

  it("targets report and external-account collections for their own events", () => {
    expect(invalidationsFor(event("report_generated"))).toContainEqual(["reports"]);
    expect(invalidationsFor(event("external_balance_recorded", "money_tax"))).toContainEqual([
      "wealth",
      "external-accounts",
    ]);
  });
});
