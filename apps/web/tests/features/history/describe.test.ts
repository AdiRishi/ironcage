import {
  type AliasRecord,
  CategoryId,
  type CounterpartyChangeEntry,
  CounterpartyChangeId,
  CounterpartyId,
  type CounterpartyImages,
  type CounterpartyRecord,
  EventId,
  Instant,
  type ReferenceData,
} from "@repo/contracts/finance";
import { expect, test } from "vitest";

import { describeCounterpartyChange, scopeLabel } from "@/features/history/describe";

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
    Partial<Pick<typeof CounterpartyChangeEntry.Type, "undoes">>,
): typeof CounterpartyChangeEntry.Type => ({
  id: CounterpartyChangeId.make("00000000-0000-4000-8000-0000000000c1"),
  undoes: null,
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

test("a descriptor move names the counterparty it left, unless that one only proposed it", () => {
  const moved = (from: typeof AliasRecord.Type) =>
    described(
      change({
        kind: "moveAlias",
        images: { ...none, aliases: [{ before: from, after: metro(woolworths, "applied") }] },
        subjects: named(coles, woolworths),
      }),
    );
  expect(moved(metro(coles, "applied"))).toEqual({
    lines: ["Moved WOOLWORTHS METRO SURRY HILLS from Coles to Woolworths"],
    scope: "Every transaction the bank writes as WOOLWORTHS METRO SURRY HILLS",
  });
  expect(moved(metro(coles, "proposed"))).toEqual({
    lines: ["WOOLWORTHS METRO SURRY HILLS now resolves to Woolworths"],
    scope: "Every transaction the bank writes as WOOLWORTHS METRO SURRY HILLS",
  });
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
