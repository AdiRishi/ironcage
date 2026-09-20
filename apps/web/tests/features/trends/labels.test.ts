import { expect, test } from "vitest";

import { chartValue, formatMetric } from "@/features/analysis/labels";

test("unavailable chart values remain missing while measured zero remains numeric", () => {
  const missing = { kind: "unavailable", reason: "Missing coverage." } as const;
  const zero = { kind: "money", amount: { currency: "AUD", minor: 0n } } as const;
  expect(chartValue(missing)).toBeNull();
  expect(formatMetric(missing)).toBe("Unavailable");
  expect(chartValue(zero)).toBe(0);
  expect(formatMetric(zero)).toBe("0.00 AUD");
});
