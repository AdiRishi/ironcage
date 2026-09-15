import { PgClient } from "@effect/sql-pg";
import {
  AccountId,
  AccountKind,
  type FinancialEvent,
  type CreditLink,
  type CalendarDate,
  FinanceError,
} from "@repo/contracts/finance";
import { MeasureFact, eventFacts, periodMeasures, postedMonth } from "@repo/finance";
import { DateTime, Effect, Schema } from "effect";

import { money } from "../database/columns.ts";
import { readCredits } from "../relationships/repository.ts";

export const previewImpact = Effect.fn("previewImpact")(function* (
  prior: FinancialEvent,
  accepted: FinancialEvent,
) {
  return yield* previewPeriod([prior], [accepted]);
});

export const previewPeriod = Effect.fn("previewPeriod")(function* (
  prior: readonly FinancialEvent[],
  accepted: readonly FinancialEvent[],
  creditChange?: {
    before: readonly (typeof CreditLink.Type)[];
    after: readonly (typeof CreditLink.Type)[];
  },
  on?: CalendarDate,
) {
  const sql = yield* PgClient.PgClient;
  const first = prior[0];
  const primary = first?.postings.find((posting) => posting.id === first.primaryPostingId);
  if (!primary)
    return yield* new FinanceError({
      kind: "conflict",
      message: "The event has no primary posting.",
    });
  const period = postedMonth(on ?? primary.postedOn);
  const currency = primary.amount.currency;
  const currentCredits = creditChange ? creditChange.before : yield* readCredits();
  const credits = creditChange ?? { before: currentCredits, after: currentCredits };
  const facts =
    yield* sql`SELECT e.id AS "eventId", al.id AS "allocationId", e.reporting_account_id AS "accountId", p.posted_on::text AS "postedOn", e.kind, al.role, ${money(sql, "e.currency", "al.amount_minor")} AS amount, al.non_personal AS "nonPersonal"
    FROM events e JOIN postings p ON p.id = e.primary_posting_id JOIN allocations al ON al.event_id = e.id
    WHERE e.active AND e.currency = ${currency} AND p.posted_on >= ${period.start}::date AND p.posted_on < ${period.endExclusive}::date`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(MeasureFact))),
    );
  const accounts =
    yield* sql`SELECT a.id, a.kind, EXISTS (SELECT 1 FROM source_coverage c WHERE c.account_id = a.id AND c.reconciled AND c.opening_minor IS NOT NULL AND c.closing_minor IS NOT NULL AND c.opening_on <= ${period.start}::date AND c.closing_on >= ${period.endExclusive}::date - 1) AS complete FROM accounts a WHERE currency = ${currency}`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(
            Schema.Struct({ id: AccountId, kind: AccountKind, complete: Schema.Boolean }),
          ),
        ),
      ),
    );
  const [cash] =
    yield* sql`SELECT COALESCE(sum(p.amount_minor), 0)::text AS minor FROM postings p JOIN accounts a ON a.id = p.account_id WHERE a.kind = 'deposit' AND p.currency = ${currency} AND p.posted_on >= ${period.start}::date AND p.posted_on < ${period.endExclusive}::date`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Tuple([Schema.Struct({ minor: Schema.BigIntFromString })]),
        ),
      ),
    );
  const context = {
    currency,
    loanAccountIds: accounts
      .filter((account) => account.kind === "loan")
      .map((account) => account.id),
    observedCashMovement: cash.minor,
    cashComplete: accounts
      .filter((account) => account.kind === "deposit")
      .every((account) => account.complete),
    loanComplete: accounts
      .filter((account) => account.kind === "loan")
      .every((account) => account.complete),
  };
  return {
    ...period,
    basis: "posted" as const,
    currency,
    accountIds: accounts.map((account) => account.id),
    calculatedAt: DateTime.formatIso(yield* DateTime.now),
    before: periodMeasures({ ...context, facts, credits: credits.before }),
    after: periodMeasures({
      ...context,
      credits: credits.after,
      facts: [
        ...facts.filter((fact) => !prior.some((event) => event.id === fact.eventId)),
        ...accepted
          .flatMap(eventFacts)
          .filter((fact) => fact.postedOn >= period.start && fact.postedOn < period.endExclusive),
      ],
    }),
  };
});
