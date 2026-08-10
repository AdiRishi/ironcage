import { it } from "@effect/vitest";
import { expect } from "vitest";

import { PACKAGE_NAME } from "../src/index.ts";

it("the package entry point resolves", () => {
  expect(PACKAGE_NAME).toBe("@ironcage/tax");
});
