import { Schema, Struct } from "effect";

import { AccountCoverage, DateBasis, FactsStatus, Period } from "../finance/analysis.ts";
import { Currency, Instant } from "../finance/values.ts";
import { FigureId, RecordLink } from "./references.ts";

// What an answer's figures rest on, gathered by code from every read in the turn: each
// period with the one it was compared with, and the accounts in `currency` with the
// days of those periods each has no records for.
export const Basis = Schema.Struct({
  periods: Schema.Array(Schema.Struct({ period: Period, comparison: Schema.NullOr(Period) })),
  basis: DateBasis,
  currency: Currency,
  accounts: Schema.Array(
    Schema.Struct(Struct.pick(AccountCoverage.fields, ["account", "missing", "reconciled"])),
  ),
  // Accounts in other currencies, which no figure includes.
  otherCurrencyAccounts: Schema.Array(AccountCoverage.fields.account),
  calculatedAt: Instant,
});
export type Basis = typeof Basis.Type;

// What the analyst cannot do yet, so an answer says so instead of guessing.
export const UnbuiltCapability = Schema.Literals([
  "recurring",
  "forecast",
  "investments",
  "otherBanks",
]);
export type UnbuiltCapability = typeof UnbuiltCapability.Type;

// Why an answer may fall short, stated by code beside it.
export const Limit = Schema.Union([
  // Days of a period the answer read that an account has no records for.
  Schema.Struct({
    kind: Schema.Literal("missingRecords"),
    account: AccountCoverage.fields.account,
    period: Period,
  }),
  // Money whose meaning is not known yet, such as money out with no role.
  Schema.Struct({ kind: Schema.Literal("notUnderstood"), figureId: FigureId }),
  // The part of a figure that rests on the model's reading of transactions.
  Schema.Struct({ kind: Schema.Literal("modelShare"), figureId: FigureId }),
  // A list that shows its first `shown` rows, which `records` shows in full.
  Schema.Struct({
    kind: Schema.Literal("partialList"),
    shown: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    records: RecordLink,
  }),
  // Transactions whose ledger facts are waiting to be rebuilt, so figures may change.
  Schema.Struct({ kind: Schema.Literal("recalculating"), outdated: FactsStatus.fields.outdated }),
  Schema.Struct({ kind: Schema.Literal("notBuilt"), capability: UnbuiltCapability }),
]).pipe(Schema.toTaggedUnion("kind"));
export type Limit = typeof Limit.Type;
