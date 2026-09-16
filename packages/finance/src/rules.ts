import { type FinancialEvent, type Rule, type MerchantId } from "@repo/contracts/finance";

import { allocationRole } from "./events.ts";
export function ruleMatches(
  rule: Rule,
  event: FinancialEvent,
  aliases: readonly { merchantId: typeof MerchantId.Type; pattern: string }[] = [],
) {
  const condition = rule.conditions;
  return (
    (!condition.accountId || event.reportingAccountId === condition.accountId) &&
    (!condition.role || event.kind === condition.role) &&
    (!condition.merchantId ||
      event.allocations.some((allocation) => allocation.merchantId === condition.merchantId) ||
      aliases.some(
        (alias) =>
          alias.merchantId === condition.merchantId &&
          event.postings.some((posting) =>
            posting.description.toLowerCase().includes(alias.pattern),
          ),
      )) &&
    event.postings.some((posting) =>
      posting.description
        .toLocaleLowerCase("en-AU")
        .includes(condition.description.toLocaleLowerCase("en-AU")),
    )
  );
}
export function ruleActionKey(rule: Rule) {
  return rule.action.kind === "category"
    ? `category:${rule.action.categoryId}`
    : `role:${rule.action.role}`;
}
export function applyRuleAction(event: FinancialEvent, rule: Rule): FinancialEvent {
  const action = rule.action;
  return {
    ...event,
    version: event.version + 1,
    kind: action.kind === "role" ? action.role : event.kind,
    purchaseOn: action.kind === "role" && action.role !== "purchase" ? null : event.purchaseOn,
    allocations: [
      {
        ...event.allocations[0],
        role: action.kind === "role" ? allocationRole(action.role) : event.allocations[0].role,
        categoryId:
          action.kind === "category" ? action.categoryId : event.allocations[0].categoryId,
      },
    ],
  };
}
