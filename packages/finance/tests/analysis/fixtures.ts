import {
  AccountId,
  AllocationId,
  CalendarDate,
  CategoryId,
  EventId,
  PostingId,
  type FinancialEvent,
} from "@repo/contracts/finance";

import type { AnalysisSnapshot } from "../../src/analysis/measures.ts";
export const deposit = AccountId.make("00000000-0000-4000-8000-000000000010");
export const card = AccountId.make("00000000-0000-4000-8000-000000000011");
export const loan = AccountId.make("00000000-0000-4000-8000-000000000012");
export const category = CategoryId.make("00000000-0000-4000-8000-000000000020");
export function purchase(
  index: number,
  minor: bigint,
  on = "2026-08-01",
  accountId = deposit,
): FinancialEvent {
  const id = `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  return {
    id: EventId.make(id),
    kind: "purchase",
    roleSource: "bank",
    counterpartyId: null,
    counterpartySource: null,
    magnitude: { currency: "AUD", minor },
    primaryPostingId: PostingId.make(id),
    reportingAccountId: accountId,
    purchaseOn: null,
    active: true,
    version: 1,
    allocations: [
      {
        id: AllocationId.make(id),
        role: "purchase",
        amount: { currency: "AUD", minor },
        categoryId: category,
        categorySource: "counterparty",
        nonPersonal: false,
        tagIds: [],
        personalEventIds: [],
      },
    ],
    postings: [
      {
        id: PostingId.make(id),
        accountId,
        accountLabel: "Synthetic",
        postedOn: CalendarDate.make(on),
        valueOn: null,
        amount: { currency: "AUD", minor: -minor },
        description: "Synthetic purchase",
        originalMoney: null,
      },
    ],
  };
}
export function snapshot(events: readonly FinancialEvent[]): AnalysisSnapshot {
  return {
    accounts: [
      {
        id: deposit,
        kind: "deposit",
        label: "Everyday",
        currency: "AUD",
        bankId: null,
        accountNumber: null,
        version: 1,
      },
      {
        id: card,
        kind: "card",
        label: "Card",
        currency: "AUD",
        bankId: null,
        accountNumber: null,
        version: 1,
      },
      {
        id: loan,
        kind: "loan",
        label: "Home loan",
        currency: "AUD",
        bankId: null,
        accountNumber: null,
        version: 1,
      },
    ],
    events,
    credits: [],
    postings: events.flatMap((event) => event.postings),
    sources: [deposit, card, loan].map((accountId) => ({
      accountId,
      observedStart: CalendarDate.make("2026-07-01"),
      observedEnd: CalendarDate.make("2026-08-31"),
      openingOn: CalendarDate.make("2026-07-01"),
      closingOn: CalendarDate.make("2026-08-31"),
      reconciled: true,
    })),
    imports: [],
    references: {
      categories: [
        {
          id: category,
          parentId: null,
          name: "Delivery",
          slug: null,
          tree: "spending",
          position: 0,
          archived: false,
          version: 1,
        },
      ],
      counterparties: [],
      tags: [],
      personalEvents: [],
    },
  };
}
