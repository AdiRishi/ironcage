import { Schema, Struct } from "effect";

import { CorrectionPreview, TransactionPatch } from "../finance/corrections.ts";
import {
  Counterparty,
  CounterpartyChange,
  CounterpartyChangePreview,
} from "../finance/counterparties.ts";
import { FinancialEvent } from "../finance/events.ts";
import { CategoryId, CounterpartyId, CounterpartyRole } from "../finance/interpretation.ts";
import { CommandId, Instant, PostingId } from "../finance/values.ts";

export const ProposalId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("ProposalId"));
export type ProposalId = typeof ProposalId.Type;

// What the analyst proposed, which Preview again reads against the records as they are
// then. A counterparty default names each default it changes, and a null one removes it.
export const ProposalIntent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("transaction"),
    postingId: PostingId,
    patch: TransactionPatch,
  }),
  Schema.Struct({
    kind: Schema.Literal("counterpartyDefault"),
    counterpartyId: CounterpartyId,
    defaultRole: Schema.optionalKey(Schema.NullOr(CounterpartyRole)),
    defaultCategoryId: Schema.optionalKey(Schema.NullOr(CategoryId)),
  }),
  Schema.Struct({
    kind: Schema.Literal("referenceDefault"),
    counterpartyId: CounterpartyId,
    referenceKey: Schema.NonEmptyString,
    defaultRole: CounterpartyRole,
    defaultCategoryId: Schema.NullOr(CategoryId),
  }),
]).pipe(Schema.toTaggedUnion("kind"));
export type ProposalIntent = typeof ProposalIntent.Type;

// The command Accept runs, with the versions it expects and what it changes. To show
// before and after, a correction keeps the transaction as it was when previewed, and a
// counterparty change the defaults it replaces: the counterparty's own, or those of the
// reference, which are null until you set them.
export const ProposalPreview = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("correction"),
    before: FinancialEvent,
    ...CorrectionPreview.fields,
  }),
  Schema.Struct({
    kind: Schema.Literal("counterpartyChange"),
    before: Schema.Struct(Struct.pick(Counterparty.fields, ["defaultRole", "defaultCategoryId"])),
    ...CounterpartyChangePreview.fields,
    change: Schema.Union([CounterpartyChange.cases.update, CounterpartyChange.cases.saveReference]),
  }),
]).pipe(Schema.toTaggedUnion("kind"));
export type ProposalPreview = typeof ProposalPreview.Type;

// `stale` says Accept found the records changed since the preview.
export const ProposalStatus = Schema.Literals(["pending", "accepted", "ignored", "stale"]);
export type ProposalStatus = typeof ProposalStatus.Type;

// A change the analyst proposed, which does nothing until you accept it. Code writes the
// title from the preview, and only `reason` is the model's, in the answer grammar.
// `commandId` is the command that accepted it, and `resolvedAt` when you accepted or
// ignored it.
export const Proposal = Schema.Struct({
  id: ProposalId,
  intent: ProposalIntent,
  preview: ProposalPreview,
  title: Schema.String,
  reason: Schema.String,
  status: ProposalStatus,
  commandId: Schema.NullOr(CommandId),
  resolvedAt: Schema.NullOr(Instant),
});
export type Proposal = typeof Proposal.Type;

export const ProposalInput = Schema.Struct({ proposalId: ProposalId });
export const ResolveProposal = Schema.Struct({
  proposalId: ProposalId,
  outcome: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("accepted"), commandId: CommandId }),
    Schema.Struct({ kind: Schema.Literals(["ignored", "stale"]) }),
  ]),
});
export type ResolveProposal = typeof ResolveProposal.Type;
