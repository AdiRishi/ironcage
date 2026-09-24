import type { Descriptor, FinancialEvent, Rule } from "@repo/contracts/finance";

export function ruleMatches(
  rule: Rule,
  event: Pick<FinancialEvent, "reportingAccountId" | "kind" | "counterpartyId"> & {
    descriptions: readonly string[];
  },
  descriptor: Descriptor | null,
) {
  const condition = rule.conditions;
  const text = condition.description.toLocaleLowerCase("en-AU");
  return (
    (!condition.accountId || event.reportingAccountId === condition.accountId) &&
    (!condition.role || event.kind === condition.role) &&
    (!condition.counterpartyId || event.counterpartyId === condition.counterpartyId) &&
    (!condition.channel || descriptor?.channel === condition.channel) &&
    event.descriptions.some((description) => description.toLocaleLowerCase("en-AU").includes(text))
  );
}
