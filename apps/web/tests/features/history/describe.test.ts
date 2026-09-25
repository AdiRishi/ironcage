import {
  AccountId,
  type AliasRecord,
  AllocationId,
  CategoryId,
  CommandId,
  type Correction,
  CorrectionId,
  type CounterpartyChangeEntry,
  CounterpartyChangeId,
  CounterpartyId,
  type CounterpartyImages,
  type CounterpartyRecord,
  EventId,
  type FinancialEvent,
  Instant,
  PostingId,
  type ReferenceData,
} from "@repo/contracts/finance";
import { expect, test } from "vitest";

import {
  describeCorrection,
  describeCounterpartyChange,
  scopeLabel,
} from "@/features/history/describe";

const rent = CategoryId.make("00000000-0000-4000-8000-0000000000f1");
const categories: (typeof ReferenceData.Type)["categories"] = [
  {
    id: rent,
    parentId: null,
    name: "Rent",
    slug: "housing.rent",
    tree: "spending",
    position: 1,
    archived: false,
    version: 1,
  },
];
const person = (id: string, name: string): typeof CounterpartyRecord.Type => ({
  id: CounterpartyId.make(id),
  name,
  kind: "person",
  brand: null,
  defaultCategoryId: null,
  defaultRole: "purchase",
  source: "user",
  status: "applied",
  model: null,
  confidence: null,
  reason: null,
  version: 1,
});
const jane = person("00000000-0000-4000-8000-000000000001", "Jane Smith");
const duplicate = person("00000000-0000-4000-8000-000000000002", "J Smith");
const coles = person("00000000-0000-4000-8000-000000000003", "Coles");
const woolworths = person("00000000-0000-4000-8000-000000000004", "Woolworths");
const newsagency = person("00000000-0000-4000-8000-000000000005", "Surry Hills Newsagency");
const named = (...rows: (typeof CounterpartyRecord.Type)[]) =>
  rows.map((row) => ({ id: row.id, name: row.name }));
const metro = (
  holder: typeof CounterpartyRecord.Type,
  status: "applied" | "proposed",
): typeof AliasRecord.Type => ({
  aliasKey: "WOOLWORTHS METRO SURRY HILLS",
  counterpartyId: holder.id,
  source: status === "applied" ? "user" : "model",
  status,
  confidence: status === "applied" ? null : 0.5,
  reason: status === "applied" ? null : "Probably the same supermarket chain.",
  version: 1,
});
const none = {
  counterparties: [],
  aliases: [],
  references: [],
  events: [],
  rules: [],
  movements: [],
} satisfies CounterpartyImages;
const change = (
  fields: Pick<typeof CounterpartyChangeEntry.Type, "kind" | "images" | "subjects"> &
    Partial<Pick<typeof CounterpartyChangeEntry.Type, "undoes" | "descriptors">>,
): typeof CounterpartyChangeEntry.Type => ({
  id: CounterpartyChangeId.make("00000000-0000-4000-8000-0000000000c1"),
  undoes: null,
  descriptors: [],
  eventCount: 2,
  createdAt: Instant.make("2026-09-25T06:30:00.000Z"),
  undoable: true,
  undone: false,
  ...fields,
});
const described = (entry: typeof CounterpartyChangeEntry.Type) => ({
  lines: describeCounterpartyChange(entry, categories),
  scope: scopeLabel({ kind: "counterparty", change: entry }),
});

// J Smith merged into Jane Smith, who was the model's until the merge confirmed her.
const merge = {
  ...none,
  counterparties: [
    { before: duplicate, after: null },
    { before: { ...jane, source: "model" as const }, after: jane },
  ],
};

test("a merge names the counterparty it removed and the one it kept, and its undo names the one it brought back", () => {
  expect(
    described(change({ kind: "merge", images: merge, subjects: named(duplicate, jane) })),
  ).toEqual({
    lines: ["Merged J Smith into Jane Smith"],
    scope: "Every J Smith transaction",
  });
  expect(
    described(
      change({
        kind: "undo",
        undoes: {
          id: CounterpartyChangeId.make("00000000-0000-4000-8000-0000000000c0"),
          kind: "merge",
        },
        images: {
          ...none,
          counterparties: merge.counterparties.map(({ before, after }) => ({
            before: after,
            after: before,
          })),
        },
        subjects: named(duplicate, jane),
      }),
    ),
  ).toEqual({ lines: ["Undid a merge"], scope: "Every J Smith transaction" });
});

test("a descriptor move names the descriptor as the bank printed it, and the counterparty it left unless that one only proposed it", () => {
  const moved = (from: typeof AliasRecord.Type) =>
    described(
      change({
        kind: "moveAlias",
        images: { ...none, aliases: [{ before: from, after: metro(woolworths, "applied") }] },
        subjects: named(coles, woolworths),
        descriptors: [
          {
            aliasKey: "WOOLWORTHS METRO SURRY HILLS",
            text: "WOOLWORTHS METRO 77 SURRY HILLS",
            otherTexts: 0,
          },
        ],
      }),
    );
  expect(moved(metro(coles, "applied"))).toEqual({
    lines: ["Moved WOOLWORTHS METRO 77 SURRY HILLS from Coles to Woolworths"],
    scope: "Every transaction the bank writes as WOOLWORTHS METRO 77 SURRY HILLS",
  });
  expect(moved(metro(coles, "proposed"))).toEqual({
    lines: ["WOOLWORTHS METRO 77 SURRY HILLS now resolves to Woolworths"],
    scope: "Every transaction the bank writes as WOOLWORTHS METRO 77 SURRY HILLS",
  });
});

test("a descriptor the bank prints several ways reaches every one of them", () => {
  const printedAs = (otherTexts: number) =>
    described(
      change({
        kind: "moveAlias",
        images: {
          ...none,
          aliases: [{ before: metro(coles, "applied"), after: metro(woolworths, "applied") }],
        },
        subjects: named(coles, woolworths),
        descriptors: [
          {
            aliasKey: "WOOLWORTHS METRO SURRY HILLS",
            text: "WOOLWORTHS METRO 77 SURRY HILLS",
            otherTexts,
          },
        ],
      }),
    ).scope;
  expect(printedAs(1)).toBe(
    "Every transaction the bank writes as WOOLWORTHS METRO 77 SURRY HILLS or 1 similar text",
  );
  expect(printedAs(2)).toBe(
    "Every transaction the bank writes as WOOLWORTHS METRO 77 SURRY HILLS or 2 similar texts",
  );
});

test("a descriptor move that only returns a transaction you moved by hand says so and reaches one transaction", () => {
  expect(
    described(
      change({
        kind: "moveAlias",
        images: {
          ...none,
          events: [
            {
              eventId: EventId.make("00000000-0000-4000-8000-0000000000e1"),
              before: { counterpartyId: newsagency.id, counterpartySource: "user" },
              after: { counterpartyId: woolworths.id, counterpartySource: "alias" },
            },
          ],
        },
        subjects: named(newsagency, woolworths),
      }),
    ),
  ).toEqual({
    lines: [
      "A transaction you had moved to Surry Hills Newsagency follows the bank's description again",
    ],
    scope: "One transaction",
  });
});

test("a reference default names the reference, its role, and its category", () => {
  expect(
    described(
      change({
        kind: "saveReference",
        images: {
          ...none,
          references: [
            {
              before: null,
              after: {
                counterpartyId: jane.id,
                referenceKey: "rent",
                defaultRole: "purchase",
                defaultCategoryId: rent,
                version: 1,
              },
            },
          ],
        },
        subjects: named(jane),
      }),
    ),
  ).toEqual({
    lines: ["Payments marked rent set to Purchase, Rent"],
    scope: "Every Jane Smith transaction marked rent",
  });
});

// A $12.50 purchase you moved from Coles to Surry Hills Newsagency by hand.
const purchase = (
  counterparty: typeof CounterpartyRecord.Type | null,
  counterpartySource: "user" | "alias" | null,
): FinancialEvent => ({
  id: EventId.make("00000000-0000-4000-8000-0000000000e1"),
  kind: "purchase",
  roleSource: "counterparty",
  counterpartyId: counterparty?.id ?? null,
  counterpartySource,
  magnitude: { currency: "AUD", minor: 1250n },
  primaryPostingId: PostingId.make("00000000-0000-4000-8000-0000000000a1"),
  reportingAccountId: AccountId.make("00000000-0000-4000-8000-0000000000b1"),
  purchaseOn: null,
  active: true,
  version: 2,
  allocations: [
    {
      id: AllocationId.make("00000000-0000-4000-8000-0000000000d1"),
      role: "purchase",
      amount: { currency: "AUD", minor: 1250n },
      categoryId: null,
      categorySource: null,
      nonPersonal: false,
      tagIds: [],
      personalEventIds: [],
    },
  ],
  postings: [],
});
const counterpartyCorrection = (
  prior: FinancialEvent,
  accepted: FinancialEvent,
  action: "correct" | "undo",
): typeof Correction.Type => ({
  id: CorrectionId.make("00000000-0000-4000-8000-0000000000c9"),
  eventId: prior.id,
  commandId: CommandId.make("00000000-0000-4000-8000-0000000000ca"),
  prior,
  accepted,
  action,
  change: "counterparty",
  createdAt: Instant.make("2026-09-25T06:30:00.000Z"),
});

test("a transaction returned to the bank's description says so, naming the counterparty it names if any", () => {
  const moved = purchase(newsagency, "user");
  const names = named(coles, newsagency);
  expect(
    describeCorrection(
      counterpartyCorrection(moved, purchase(coles, "alias"), "undo"),
      names,
      categories,
    ),
  ).toEqual(["Undid an earlier change", "Now follows the bank's description, which names Coles"]);
  expect(
    describeCorrection(
      counterpartyCorrection(moved, purchase(null, null), "correct"),
      names,
      categories,
    ),
  ).toEqual(["Now follows the bank's description"]);
  expect(
    describeCorrection(
      counterpartyCorrection(purchase(null, null), moved, "correct"),
      names,
      categories,
    ),
  ).toEqual(["Counterparty set to Surry Hills Newsagency"]);
});
