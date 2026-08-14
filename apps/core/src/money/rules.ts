import type {
  BankAccountId,
  CategoryId,
  CategorizationRuleId,
  RulePredicate,
} from "@ironcage/domain";
import { BigDecimal } from "effect";

export interface EffectiveRule {
  readonly id: CategorizationRuleId;
  readonly predicate: RulePredicate;
  readonly categoryId: CategoryId;
  readonly categoryName: string;
}

export interface RuleSubject {
  readonly accountId: BankAccountId;
  readonly payee: string;
  readonly fingerprint: string;
  readonly amount: BigDecimal.BigDecimal;
}

const matches = (predicate: RulePredicate, subject: RuleSubject): boolean => {
  if (
    predicate.payeeEquals !== undefined &&
    predicate.payeeEquals.toLowerCase() !== subject.payee.toLowerCase()
  ) {
    return false;
  }
  if (
    predicate.narrativeContains !== undefined &&
    !predicate.narrativeContains.every((token) => subject.fingerprint.includes(token.toLowerCase()))
  ) {
    return false;
  }
  if (predicate.accountId !== undefined && predicate.accountId !== subject.accountId) return false;
  if (predicate.direction !== undefined) {
    const direction = BigDecimal.isNegative(subject.amount) ? "debit" : "credit";
    if (direction !== predicate.direction) return false;
  }
  const magnitude = BigDecimal.abs(subject.amount);
  if (
    predicate.minAbsoluteAmount !== undefined &&
    BigDecimal.isLessThan(magnitude, predicate.minAbsoluteAmount)
  ) {
    return false;
  }
  if (
    predicate.maxAbsoluteAmount !== undefined &&
    BigDecimal.isGreaterThan(magnitude, predicate.maxAbsoluteAmount)
  ) {
    return false;
  }
  return true;
};

/**
 * Rules run before AI and stop further dispatch when they match. The earliest
 * effective rule wins so a correction-created rule cannot be shadowed by a
 * later broad one without the operator seeing it.
 */
export const firstMatchingRule = (
  rules: readonly EffectiveRule[],
  subject: RuleSubject,
): EffectiveRule | null => rules.find((rule) => matches(rule.predicate, subject)) ?? null;
