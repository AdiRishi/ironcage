import { Schema } from "effect";

import { ExpectedEventVersion, MeasureImpact } from "./corrections.ts";
import { CategoryId, EventId, FinancialRole, MerchantId } from "./interpretation.ts";
import { AccountId, CommandId, Version, PostingId, CalendarDate } from "./values.ts";
export const RuleId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("RuleId"));
export const RuleConditions = Schema.Struct({
  accountId: Schema.NullOr(AccountId),
  role: Schema.NullOr(FinancialRole),
  merchantId: Schema.NullOr(MerchantId),
  description: Schema.Trim.check(Schema.isMaxLength(200)),
});
export const RuleAction = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("category"), categoryId: CategoryId }),
  Schema.Struct({ kind: Schema.Literal("role"), role: FinancialRole }),
]);
export const Rule = Schema.Struct({
  id: RuleId,
  name: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  conditions: RuleConditions,
  action: RuleAction,
  scope: Schema.Literals(["past", "future", "both"]),
  version: Version,
});
export type Rule = typeof Rule.Type;
export const Rules = Schema.Array(Rule);
export const PreviewRule = Schema.Struct({ rule: Rule, exceptionEventIds: Schema.Array(EventId) });
export const RulePreview = Schema.Struct({
  ...PreviewRule.fields,
  expectedVersions: Schema.Array(ExpectedEventVersion),
  matched: Schema.Int,
  matches: Schema.Array(
    Schema.Struct({
      eventId: EventId,
      postingId: PostingId,
      description: Schema.String,
      postedOn: CalendarDate,
    }),
  ),
  affected: Schema.Array(EventId),
  exceptions: Schema.Array(Schema.Struct({ eventId: EventId, reason: Schema.String })),
  conflicts: Schema.Array(EventId),
  impacts: Schema.Array(MeasureImpact),
});
export const SaveRule = Schema.Struct({
  ...PreviewRule.fields,
  commandId: CommandId,
  expectedVersion: Schema.NullOr(Version),
  expectedVersions: Schema.Array(ExpectedEventVersion),
});
export const DeleteRule = Schema.Struct({
  commandId: CommandId,
  ruleId: RuleId,
  expectedVersion: Version,
});
export const RuleInput = Schema.Struct({ ruleId: RuleId });
export const RuleExceptions = Schema.Array(EventId);
