import {
  AllocationId,
  CalendarDate,
  EventId,
  type InterpretationReview,
  PostingId,
  ReviewItemId,
} from "@repo/contracts/finance";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { Suspense } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { getEvent } from "@/features/events/functions";
import {
  applyRelationship,
  dismissInterpretationReview,
  getEventRelationships,
  listInterpretationReviews,
  listRelationshipCandidates,
  previewRelationship,
  proposeRelationships,
} from "@/features/relationships/functions";
import { RelationshipProposals } from "@/features/relationships/reviews";
import { getRetention, getSettings } from "@/features/settings/functions";
import { createQueryClient } from "@/lib/query-client";

// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/events/functions", () => ({
  getEvent: vi.fn<typeof getEvent>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/relationships/functions", () => ({
  getEventRelationships: vi.fn<typeof getEventRelationships>(),
  listRelationshipCandidates: vi.fn<typeof listRelationshipCandidates>(),
  listInterpretationReviews: vi.fn<typeof listInterpretationReviews>(),
  proposeRelationships: vi.fn<typeof proposeRelationships>(),
  dismissInterpretationReview: vi.fn<typeof dismissInterpretationReview>(),
  previewRelationship: vi.fn<typeof previewRelationship>(),
  applyRelationship: vi.fn<typeof applyRelationship>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/settings/functions", () => ({
  getSettings: vi.fn<typeof getSettings>(),
  getRetention: vi.fn<typeof getRetention>(),
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const aud = (minor: bigint) => ({ currency: "AUD", minor }) as const;
const event = (n: number, description: string, minor: bigint) => ({
  id: EventId.make(id(n)),
  primaryPostingId: PostingId.make(id(100 + n)),
  description,
  magnitude: aud(minor),
});
const refund = event(1, "Refund Purchase MYER SYDNEY", 4000n);
const purchase = event(2, "MYER SYDNEY AU Card xx1234", 12000n);
const toCard = event(3, "Transfer to xx9999 CommBank app Card", 12000n);
const payment = event(4, "Payment Received, Thank You", 12000n);
const credit = {
  id: ReviewItemId.make(id(201)),
  events: [refund, purchase],
  proposal: {
    kind: "credit",
    link: {
      creditAllocationId: AllocationId.make(id(301)),
      costAllocationId: AllocationId.make(id(302)),
      amount: aud(4000n),
    },
  },
  postingId: refund.primaryPostingId,
  postedOn: CalendarDate.make("2026-08-02"),
  version: 1,
} satisfies typeof InterpretationReview.Type;
const movement = {
  id: ReviewItemId.make(id(202)),
  events: [toCard, payment],
  proposal: { kind: "movement" },
  postingId: toCard.primaryPostingId,
  postedOn: CalendarDate.make("2026-07-20"),
  version: 1,
} satisfies typeof InterpretationReview.Type;

// Refunds to link and movements to confirm, whose transactions never load on their own.
async function renderProposals() {
  vi.mocked(listInterpretationReviews).mockResolvedValue({
    rows: [credit, movement],
    nextCursor: null,
  });
  vi.mocked(getEvent).mockReturnValue(new Promise(() => {}));
  const root = createRootRoute({
    component: () => (
      <Suspense fallback={<p>Loading</p>}>
        <RelationshipProposals />
      </Suspense>
    ),
  });
  const router = createRouter({ routeTree: root, history: createMemoryHistory() });
  const client = createQueryClient();
  const screen = await render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return async () => {
    await screen.unmount();
    client.clear();
    vi.mocked(listInterpretationReviews).mockReset();
    vi.mocked(getEvent).mockReset();
  };
}

test("each proposal links its transactions with their amounts from the proposal list alone", async ({
  onTestFinished,
}) => {
  onTestFinished(await renderProposals());

  const credits = page.getByRole("region", { name: "Refunds to link" });
  await expect
    .element(credits.getByRole("link", { name: "Refund Purchase MYER SYDNEY · $40.00" }))
    .toHaveAttribute("href", `/ledger/${refund.primaryPostingId}`);
  await expect
    .element(credits.getByRole("link", { name: "MYER SYDNEY AU Card xx1234 · $120.00" }))
    .toHaveAttribute("href", `/ledger/${purchase.primaryPostingId}`);
  const movements = page.getByRole("region", { name: "Movements to confirm" });
  await expect
    .element(
      movements.getByRole("link", { name: "Transfer to xx9999 CommBank app Card · $120.00" }),
    )
    .toHaveAttribute("href", `/ledger/${toCard.primaryPostingId}`);
  await expect
    .element(movements.getByRole("link", { name: "Payment Received, Thank You · $120.00" }))
    .toHaveAttribute("href", `/ledger/${payment.primaryPostingId}`);
});
