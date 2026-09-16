import type {
  Allocation,
  AnalysisQuery,
  CreditLink,
  EventId,
  FinancialRole,
  Posting,
  Period,
  GroupBy,
} from "@repo/contracts/finance";

import { allocationMeasures } from "../impact.ts";
import { eventDate, type AnalysisSnapshot } from "./measures.ts";
import { inPeriod } from "./periods.ts";
export type Contribution = {
  key: string;
  eventId: typeof EventId.Type | null;
  kind: FinancialRole;
  posting: Posting;
  postings: readonly Posting[];
  on: Posting["postedOn"];
  allocation: typeof Allocation.Type | null;
  amount: bigint;
  credits: readonly (typeof CreditLink.Type)[];
};
export function selectContributions(
  snapshot: AnalysisSnapshot,
  query: AnalysisQuery,
  period: Period,
): Contribution[] {
  if (query.measure === "cashBalanceChange")
    return snapshot.postings
      .filter(
        (posting) =>
          inPeriod(posting.postedOn, period) &&
          snapshot.accounts.some(
            (account) => account.id === posting.accountId && account.kind === "deposit",
          ),
      )
      .map((posting) => {
        const event = snapshot.events.find((item) =>
          item.postings.some((row) => row.id === posting.id),
        );
        return {
          key: posting.id,
          eventId: event?.id ?? null,
          kind: event?.kind ?? "unresolved",
          posting,
          postings: event?.postings ?? [posting],
          on: posting.postedOn,
          allocation: null,
          amount: posting.amount.minor,
          credits: [],
        };
      });
  const categoryIds = new Set(query.filters.categories);
  let size = -1;
  while (size !== categoryIds.size) {
    size = categoryIds.size;
    for (const category of snapshot.references.categories)
      if (category.parentId && categoryIds.has(category.parentId)) categoryIds.add(category.id);
  }
  const facts: Contribution[] = [];
  for (const event of snapshot.events) {
    if (
      !event.active ||
      !snapshot.accounts.some((account) => account.id === event.reportingAccountId)
    )
      continue;
    const primary = event.postings.find((posting) => posting.id === event.primaryPostingId);
    if (!primary) continue;
    if (query.measure === "netPrincipalReduction") {
      const posting = event.postings.find((row) =>
        snapshot.accounts.some(
          (account) => account.kind === "loan" && account.id === row.accountId,
        ),
      );
      if (
        posting &&
        inPeriod(posting.postedOn, period) &&
        (event.kind === "loanPayment" || event.kind === "financingCost")
      )
        facts.push({
          key: posting.id,
          eventId: event.id,
          kind: event.kind,
          posting,
          postings: event.postings,
          on: posting.postedOn,
          allocation: null,
          amount: posting.amount.minor,
          credits: [],
        });
      continue;
    }
    const on = eventDate(event, query.basis);
    if (!on || !inPeriod(on, period)) continue;
    for (const allocation of event.allocations) {
      const filters = query.filters;
      if (
        (categoryIds.size && (!allocation.categoryId || !categoryIds.has(allocation.categoryId))) ||
        (filters.merchants.length &&
          (!allocation.merchantId || !filters.merchants.includes(allocation.merchantId))) ||
        (filters.tags.length && !allocation.tagIds.some((id) => filters.tags.includes(id))) ||
        (filters.personalEvents.length &&
          !allocation.personalEventIds.some((id) => filters.personalEvents.includes(id)))
      )
        continue;
      const cost = allocation.role === "purchase" || allocation.role === "financingCost";
      const eligible =
        query.measure === "purchaseCount"
          ? event.kind === "purchase"
          : query.measure === "income"
            ? allocation.role === "income"
            : query.measure === "surplus" || query.measure === "surplusRate"
              ? cost || allocation.role === "income"
              : cost;
      if (!eligible) continue;
      const amounts = allocationMeasures(
        { ...allocation, allocationId: allocation.id },
        snapshot.credits,
      );
      const amount =
        query.measure === "grossCosts"
          ? amounts.gross
          : query.measure === "income"
            ? amounts.income
            : query.measure === "surplus" || query.measure === "surplusRate"
              ? amounts.income - amounts.net
              : amounts.net;
      facts.push({
        key: allocation.id,
        eventId: event.id,
        kind: event.kind,
        posting: primary,
        postings: event.postings,
        on,
        allocation,
        amount,
        credits: snapshot.credits.filter((link) => link.costAllocationId === allocation.id),
      });
    }
  }
  return facts;
}
export function contributionGroups(fact: Contribution, groupBy: GroupBy): readonly string[] {
  switch (groupBy) {
    case "account":
      return [fact.posting.accountId];
    case "category":
      return [fact.allocation?.categoryId ?? "unassigned"];
    case "merchant":
      return [fact.allocation?.merchantId ?? "unassigned"];
    case "tag":
      return fact.allocation?.tagIds.length ? fact.allocation.tagIds : ["unassigned"];
    case "personalEvent":
      return fact.allocation?.personalEventIds.length
        ? fact.allocation.personalEventIds
        : ["unassigned"];
  }
}
export function groupLabel(snapshot: AnalysisSnapshot, groupBy: GroupBy, key: string) {
  if (key === "unassigned") return "Unassigned";
  switch (groupBy) {
    case "account":
      return snapshot.accounts.find((account) => account.id === key)?.label ?? key;
    case "category":
      return snapshot.references.categories.find((item) => item.id === key)?.name ?? key;
    case "merchant":
      return snapshot.references.merchants.find((item) => item.id === key)?.name ?? key;
    case "tag":
      return snapshot.references.tags.find((item) => item.id === key)?.name ?? key;
    case "personalEvent":
      return snapshot.references.personalEvents.find((item) => item.id === key)?.name ?? key;
  }
}
