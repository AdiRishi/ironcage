import { exports } from "cloudflare:workers";
import { expect, test } from "vitest";

import "../src/index";

test("responds over the default fetch handler", async () => {
  const response = await exports.default.fetch("https://ironcage.test/");

  expect(response.status).toBe(200);
  expect(await response.text()).toContain("ironcage-compute");
});
