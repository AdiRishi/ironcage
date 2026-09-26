import type { AskContext } from "@repo/contracts/analyst";
import type { CountedScope, FlowStream, Money, PeriodFlow } from "@repo/contracts/finance";
import { leftOver } from "@repo/finance";
import { linkOptions } from "@tanstack/react-router";

import { countedSearch } from "@/features/ledger/search";
import { categoryColor, categoryRank } from "@/lib/category-colors";
import {
  type ComparisonKey,
  comparisonSelection,
  type PeriodChoice,
  periodSelection,
} from "@/lib/period";
import { scopeSearch } from "@/lib/scope";

// A spending category opens Spending at its scope. Every other stream opens the records
// it counts.
export function streamLink(stream: FlowStream) {
  return stream.kind === "category"
    ? linkOptions({ to: "/spending", search: scopeSearch(stream.scope) })
    : linkOptions({ to: "/ledger", search: countedSearch(stream.scope) });
}

// What "Ask about this" asks about: the facts a stream sums in the period, against the
// comparison.
export const streamContext = (
  scope: CountedScope,
  period: PeriodChoice,
  compare: ComparisonKey | undefined,
) =>
  ({
    kind: "stream",
    period: periodSelection(period),
    comparison: comparisonSelection(compare),
    scope,
  }) satisfies AskContext;

type Drawn = {
  key: string;
  label: string;
  amount: Money;
  side: "in" | "out";
  color: string;
};
// The facts a stream sums, and the screen that lists them.
type Counted = { scope: CountedScope; link: ReturnType<typeof streamLink> };
// A stream as drawn. `moneyBack` is a spending category where more came back than went
// out, drawn coming in. Kept and From savings balance the two sides: they say what they
// are and have no records to open.
export type FlowEntry =
  | (Drawn & Counted & { kind: "stream" })
  | (Drawn & Counted & { kind: "moneyBack"; category: string })
  | (Drawn & { kind: "balance"; explanation: string });

const outOrder = ["uncategorised", "loanPrincipal", "externalOut", "unresolvedOut"];
const outRank = (stream: FlowStream) =>
  stream.kind === "category" ? categoryRank(stream.slug) : outOrder.indexOf(stream.kind) + 20;
const streamColor = (stream: FlowStream) => {
  switch (stream.kind) {
    case "category":
      return categoryColor(stream.slug);
    case "loanPrincipal":
      return "var(--intaglio)";
    default:
      return "var(--category-other)";
  }
};

// Inflows on the left, outflows on the right, balanced through the middle. Kept and From
// savings balance the sides from the headline totals, so the diagram shows the
// headline's left over.
export function flowStreams(flow: PeriodFlow) {
  const money = (minor: bigint) => ({ currency: flow.currency, minor });
  const balance = (
    key: string,
    side: FlowEntry["side"],
    label: string,
    amount: Money,
    explanation: string,
  ): FlowEntry => ({
    kind: "balance",
    key,
    label,
    amount,
    side,
    color: "var(--rule)",
    explanation,
  });
  const inflows = [
    ...flow.inflows
      .filter((stream) => stream.amount.minor > 0n)
      .map((stream): FlowEntry => ({
        kind: "stream",
        key: stream.key,
        label: stream.label,
        amount: stream.amount,
        side: "in",
        color: "var(--eucalypt)",
        scope: stream.scope,
        link: streamLink(stream),
      })),
    ...flow.outflows
      .filter((stream) => stream.amount.minor < 0n)
      .map((stream): FlowEntry => ({
        kind: "moneyBack",
        key: stream.key,
        label: `${stream.label}, net money back`,
        category: stream.label,
        amount: money(-stream.amount.minor),
        side: "in",
        color: streamColor(stream),
        scope: stream.scope,
        link: streamLink(stream),
      })),
  ];
  const outflows = flow.outflows
    .filter((stream) => stream.amount.minor > 0n)
    .toSorted((a, b) => outRank(a) - outRank(b))
    .map((stream): FlowEntry => ({
      kind: "stream",
      key: stream.key,
      label: stream.label,
      amount: stream.amount,
      side: "out",
      color: streamColor(stream),
      scope: stream.scope,
      link: streamLink(stream),
    }));
  const surplus = leftOver(flow.totals).minor;
  return {
    inflows:
      surplus < 0n
        ? [
            ...inflows,
            balance(
              "fromSavings",
              "in",
              "From savings",
              money(-surplus),
              "What went out beyond what came in",
            ),
          ]
        : inflows,
    outflows:
      surplus > 0n
        ? [
            ...outflows,
            balance("kept", "out", "Kept", money(surplus), "What came in less what went out"),
          ]
        : outflows,
  };
}
