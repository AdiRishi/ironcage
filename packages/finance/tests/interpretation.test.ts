import { describe, expect, it } from "@effect/vitest";
import {
  AccountId,
  CategoryId,
  CounterpartyId,
  RuleId,
  type CategoryTree,
  type Rule,
} from "@repo/contracts/finance";

import {
  accountSuffix,
  bankReading,
  deriveInterpretation,
  describeCommBank,
  ruleActions,
  type CounterpartyDefaults,
  type OwnedAccount,
} from "../src/index.ts";

const category = (n: number) =>
  CategoryId.make(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
const rent = category(101);
const clothing = category(150);
const groceries = category(1);
const mortgageInterest = category(102);
const salary = category(190);
const trees = new Map<string, CategoryTree>([
  [rent, "spending"],
  [clothing, "spending"],
  [groceries, "spending"],
  [mortgageInterest, "spending"],
  [salary, "income"],
]);
const slugs = new Map([
  ["housing.mortgage-interest", mortgageInterest],
  ["income-salary", salary],
]);
const owned: OwnedAccount[] = [
  { id: AccountId.make("00000000-0000-4000-8000-00000000a001"), kind: "deposit", suffix: "1111" },
  { id: AccountId.make("00000000-0000-4000-8000-00000000a002"), kind: "deposit", suffix: "5678" },
  { id: AccountId.make("00000000-0000-4000-8000-00000000a003"), kind: "card", suffix: "9012" },
];
const counterpartyId = CounterpartyId.make("00000000-0000-4000-8000-00000000c001");
const fresh = {
  kind: "unresolved" as const,
  roleSource: null,
  counterpartyId: null,
  counterpartySource: null,
  allocations: [{ categoryId: null, categorySource: null }],
};

function derive({
  description,
  amountMinor,
  accountKind = "deposit",
  event = fresh,
  counterparty = null,
  rules = [],
}: {
  description: string;
  amountMinor: bigint;
  accountKind?: "deposit" | "card" | "loan";
  event?: Parameters<typeof deriveInterpretation>[0]["event"];
  counterparty?: CounterpartyDefaults | null;
  rules?: Rule[];
}) {
  const descriptor = describeCommBank({ description, amountMinor, accountKind });
  return deriveInterpretation({
    event,
    amountMinor,
    bank: bankReading({ descriptor, description, amountMinor, accountKind, ownedAccounts: owned }),
    aliasCounterpartyId: counterparty?.id ?? null,
    counterparty,
    rules: ruleActions(rules),
    categoryTree: (id) => trees.get(id) ?? null,
    categoryIdForSlug: (slug) => slugs.get(slug) ?? null,
  });
}
const person = (fields: Partial<CounterpartyDefaults> = {}): CounterpartyDefaults => ({
  id: counterpartyId,
  kind: "person",
  defaultRole: null,
  defaultCategoryId: null,
  applied: true,
  ...fields,
});
const rule = (action: Rule["action"], n = 1): Rule => ({
  id: RuleId.make(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`),
  name: `Rule ${n}`,
  conditions: { accountId: null, role: null, counterpartyId: null, channel: null, description: "" },
  action,
  scope: "both",
  version: 1,
});

describe("deriveInterpretation", () => {
  it("treats a transfer to one of your accounts as a movement, not spending", () => {
    expect(
      derive({ description: "Transfer to xx5678 CommBank app", amountMinor: -200000n }),
    ).toMatchObject({
      kind: "transfer",
      roleSource: "bank",
      categoryId: null,
    });
    expect(
      derive({ description: "Transfer to xx9012 CommBank app", amountMinor: -100000n }).kind,
    ).toBe("cardSettlement");
  });

  it("leaves a transfer to an unknown own-account suffix unresolved", () => {
    expect(
      derive({ description: "Transfer to xx9921 CommBank app", amountMinor: -500000n }).kind,
    ).toBe("unresolved");
  });

  it("leaves a payment to a person unresolved until the person has a default", () => {
    const payment = { description: "Transfer To Jane Smith NetBank Rent", amountMinor: -184000n };
    expect(derive({ ...payment, counterparty: person() }).kind).toBe("unresolved");
    expect(
      derive({
        ...payment,
        counterparty: person({ defaultRole: "purchase", defaultCategoryId: rent }),
      }),
    ).toMatchObject({
      kind: "purchase",
      roleSource: "counterparty",
      categoryId: rent,
      categorySource: "counterparty",
      counterpartySource: "alias",
    });
  });

  it("ignores a counterparty whose proposal has not been applied", () => {
    expect(
      derive({
        description: "UNIQLO SYDNEY Card xx1234",
        amountMinor: -4990n,
        counterparty: {
          id: counterpartyId,
          kind: "business",
          defaultRole: null,
          defaultCategoryId: clothing,
          applied: false,
        },
      }),
    ).toMatchObject({ kind: "purchase", roleSource: "bank", categoryId: null });
  });

  it("puts a card refund in the counterparty's spending category", () => {
    const business: CounterpartyDefaults = {
      id: counterpartyId,
      kind: "business",
      defaultRole: null,
      defaultCategoryId: clothing,
      applied: true,
    };
    expect(
      derive({
        description: "Return UNIQLO Card xx1234",
        amountMinor: 4000n,
        counterparty: business,
      }),
    ).toMatchObject({ kind: "refund", categoryId: clothing });
  });

  it("keeps a category you set when the counterparty default differs", () => {
    expect(
      derive({
        description: "BUNNINGS Card xx1234",
        amountMinor: -12000n,
        event: { ...fresh, allocations: [{ categoryId: groceries, categorySource: "user" }] },
        counterparty: person({ kind: "business", defaultCategoryId: clothing }),
      }),
    ).toMatchObject({ categoryId: groceries, categorySource: "user" });
  });

  it("applies a rule over the counterparty default and ignores rules that disagree", () => {
    const shop = person({ kind: "business", defaultCategoryId: clothing });
    const purchase = { description: "KMART Card xx1234", amountMinor: -3000n, counterparty: shop };
    expect(
      derive({ ...purchase, rules: [rule({ kind: "category", categoryId: groceries })] }),
    ).toMatchObject({ categoryId: groceries, categorySource: "rule" });
    expect(
      derive({
        ...purchase,
        rules: [
          rule({ kind: "category", categoryId: groceries }, 1),
          rule({ kind: "category", categoryId: rent }, 2),
        ],
      }),
    ).toMatchObject({ categoryId: clothing, categorySource: "counterparty" });
  });

  it("reads bank-structured rows without a counterparty", () => {
    expect(
      derive({ description: "Interest charged", amountMinor: -280000n, accountKind: "loan" }),
    ).toMatchObject({
      kind: "financingCost",
      categoryId: mortgageInterest,
      categorySource: "bank",
    });
    expect(
      derive({ description: "Salary ACME PTY LTD HR123456", amountMinor: 500000n }),
    ).toMatchObject({
      kind: "income",
      categoryId: salary,
    });
  });

  it("never puts an income category on spending", () => {
    expect(
      derive({
        description: "Transfer To Jane Smith NetBank",
        amountMinor: -5000n,
        counterparty: person({ defaultRole: "purchase", defaultCategoryId: salary }),
      }),
    ).toMatchObject({ kind: "purchase", categoryId: null });
  });
});

describe("accountSuffix", () => {
  it("names an account by the last four digits of its number, whatever separates them", () => {
    expect(accountSuffix("06 2000 1234 9239")).toBe("9239");
    expect(accountSuffix("4000-1234-56")).toBe("3456");
    expect(accountSuffix("12 3")).toBeNull();
  });
});
