import { describe, expect, test } from "vitest";

import { migrationMode } from "../../../lib/migrations/arguments.ts";

describe("migrationMode", () => {
  test("plans unless application is explicitly requested", () => {
    expect(migrationMode([])).toBe("plan");
    expect(migrationMode(["--plan"])).toBe("plan");
    expect(migrationMode(["--apply"])).toBe("apply");
  });

  test("rejects contradictory or unknown arguments", () => {
    expect(() => migrationMode(["--plan", "--apply"])).toThrow("choose either --plan or --apply");
    expect(() => migrationMode(["--force"])).toThrow("unknown migration argument(s): --force");
  });
});
