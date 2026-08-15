import { describe, expect, it, vi } from "vitest";

import { visibleSafetyPoll } from "@/data/polling";

describe("system safety polling", () => {
  it("polls while the application is visible", () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    expect(visibleSafetyPoll()).toBe(60_000);
  });

  it("leaves the WebSocket as the only live path while hidden", () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    expect(visibleSafetyPoll()).toBe(false);
  });
});
