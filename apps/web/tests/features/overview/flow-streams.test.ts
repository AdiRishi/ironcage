import { expect, test } from "vitest";

import { flowStreams } from "@/features/overview/flow-streams";

import { august, travel } from "./period-flow";

const sum = (entries: ReadonlyArray<{ amount: { minor: bigint } }>) =>
  entries.reduce((total, entry) => total + entry.amount.minor, 0n);

test("kept is the headline's left over when refunds leave a category net money back", () => {
  const { inflows, outflows } = flowStreams(august);

  expect(outflows.at(-1)).toMatchObject({
    kind: "balance",
    label: "Kept",
    amount: { minor: 374000n },
  });
  expect(sum(inflows)).toBe(930000n);
  expect(sum(outflows)).toBe(930000n);
});

test("a category with more money back than spent is drawn coming in, and opens Spending", () => {
  const { inflows, outflows } = flowStreams(august);

  expect(inflows.find((entry) => entry.key === `category:${travel}`)).toMatchObject({
    kind: "moneyBack",
    label: "Travel, net money back",
    amount: { minor: 30000n },
    link: { to: "/spending", search: { category: travel } },
  });
  expect(outflows.map((entry) => entry.label)).not.toContain("Travel");
});
