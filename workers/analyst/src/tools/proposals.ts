import {
  type Proposal,
  ProposalId,
  ProposalIntent,
  type ProposalPreview,
  type TurnStep,
} from "@repo/contracts/analyst";
import {
  type CounterpartyDetail,
  type CounterpartyReference,
  type EventChange,
  FinanceError,
  type FinancialEvent,
} from "@repo/contracts/finance";
import { dateLabel, financialRoleLabels, formatCurrency, patchEvent } from "@repo/finance";
import type { Api } from "@repo/infra/api";
import { Array as Arr, Effect, Schema, Struct } from "effect";
import { Tool } from "effect/unstable/ai";

import { checkAgainst } from "../answers/check.ts";
import { TurnEvidence } from "../evidence/service.ts";
import { counterpartyLink } from "./counterparties.ts";
import { type Names, namesIn, readPosting, transactionLink } from "./transactions.ts";

type ProposalApi = Pick<
  Api,
  | "getPosting"
  | "getEventForPosting"
  | "getReferenceData"
  | "getCounterparty"
  | "previewCorrection"
  | "previewCounterpartyChange"
>;

// What a proposal is as the records are now: the command Accept would run and what it
// changes, the title code writes for it, and the step that previews it. A title never
// quotes the bank's text, because the model reads it.
type Previewed = Pick<Proposal, "preview" | "title"> & { readonly step: TurnStep };

const listed = (items: ReadonlyArray<string>) =>
  new Intl.ListFormat("en-AU", { type: "conjunction" }).format(items);
const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

const unchanged = (subject: string) =>
  new FinanceError({ kind: "invalid", message: `This change leaves ${subject} as it is.` });

// A name the reference data holds, or a failure the model reads when it passed an ID
// that names nothing.
const known = (name: string | null) =>
  name === null
    ? Effect.fail(
        new FinanceError({
          kind: "invalid",
          message:
            "An ID names no category, tag, or personal event. Use the IDs ReadCategories returns.",
        }),
      )
    : Effect.succeed(name);

// What a change does to a transaction that is not split, one phrase for each part it
// changes, each naming the transaction as it is given.
const transactionPhrases = Effect.fnUntraced(function* (
  event: FinancialEvent,
  change: EventChange,
  names: Names,
) {
  const [before] = event.allocations;
  const [after] = change.allocations;
  const phrases: Array<(it: string) => string> = [];
  const role = financialRoleLabels[change.kind];
  if (change.kind !== event.kind) phrases.push((it) => `give ${it} the role ${role}`);
  if (after.categoryId !== null && after.categoryId !== before.categoryId) {
    const category = yield* known(names.category(after.categoryId));
    phrases.push((it) => `move ${it} to ${category}`);
  } else if (after.categoryId === null && before.categoryId !== null) {
    const category = yield* known(names.category(before.categoryId));
    phrases.push((it) => `take ${it} out of ${category}`);
  }
  if (after.nonPersonal !== before.nonPersonal) {
    const personal = after.nonPersonal ? "non-personal" : "personal";
    phrases.push((it) => `mark ${it} as ${personal}`);
  }
  const tagged = yield* Effect.forEach(Arr.difference(after.tagIds, before.tagIds), (id) =>
    known(names.tag(id)),
  );
  if (tagged.length > 0) phrases.push((it) => `tag ${it} ${listed(tagged)}`);
  const untagged = yield* Effect.forEach(Arr.difference(before.tagIds, after.tagIds), (id) =>
    known(names.tag(id)),
  );
  if (untagged.length > 0) {
    const tags = untagged.length === 1 ? "tag" : "tags";
    phrases.push((it) => `take the ${tags} ${listed(untagged)} off ${it}`);
  }
  const joined = yield* Effect.forEach(
    Arr.difference(after.personalEventIds, before.personalEventIds),
    (id) => known(names.personalEvent(id)),
  );
  if (joined.length > 0) phrases.push((it) => `add ${it} to ${listed(joined)}`);
  const left = yield* Effect.forEach(
    Arr.difference(before.personalEventIds, after.personalEventIds),
    (id) => known(names.personalEvent(id)),
  );
  if (left.length > 0) phrases.push((it) => `take ${it} out of ${listed(left)}`);
  const { purchaseOn } = change;
  if (purchaseOn !== event.purchaseOn)
    phrases.push(
      purchaseOn === null
        ? (it) => `take the purchase date off ${it}`
        : (it) => `give ${it} the purchase date ${dateLabel(purchaseOn)}`,
    );
  return phrases;
});

const transactionProposal = Effect.fnUntraced(function* (
  api: ProposalApi,
  intent: typeof ProposalIntent.cases.transaction.Type,
) {
  const { event, names, name } = yield* readPosting(api, intent.postingId);
  if (event === null)
    return yield* new FinanceError({
      kind: "conflict",
      message: "This transaction is not interpreted yet, so it has no meaning to change.",
    });
  const change = yield* Effect.fromResult(patchEvent(event, intent.patch));
  const phrases = yield* transactionPhrases(event, change, names);
  if (phrases.length === 0) return yield* unchanged(name);
  const preview = yield* api.previewCorrection({ change });
  const subject = `${name} (${formatCurrency(event.magnitude)})`;
  return {
    preview: { kind: "correction", before: event, ...preview },
    title: sentence(listed(phrases.map((phrase, index) => phrase(index === 0 ? subject : "it")))),
    step: {
      label: `Previewing a change to ${name}`,
      records: transactionLink(intent.postingId),
    },
  } satisfies Previewed;
});

const counterpartyChangeProposal = Effect.fnUntraced(function* (
  api: ProposalApi,
  counterparty: (typeof CounterpartyDetail.Type)["counterparty"],
  {
    change,
    before,
  }: Pick<typeof ProposalPreview.cases.counterpartyChange.Type, "change" | "before">,
  title: string,
) {
  const preview = yield* api.previewCounterpartyChange({ change });
  return {
    preview: { kind: "counterpartyChange", ...preview, change, before },
    title,
    step: {
      label: `Previewing the defaults for ${counterparty.name}`,
      records: counterpartyLink(counterparty.id),
    },
  } satisfies Previewed;
});

const counterpartyDefaultProposal = Effect.fnUntraced(function* (
  api: ProposalApi,
  intent: typeof ProposalIntent.cases.counterpartyDefault.Type,
) {
  const [{ counterparty }, reference] = yield* Effect.all(
    [api.getCounterparty({ counterpartyId: intent.counterpartyId }), api.getReferenceData()],
    { concurrency: "unbounded" },
  );
  const defaultRole =
    intent.defaultRole === undefined ? counterparty.defaultRole : intent.defaultRole;
  const defaultCategoryId =
    intent.defaultCategoryId === undefined
      ? counterparty.defaultCategoryId
      : intent.defaultCategoryId;
  const phrases: Array<string> = [];
  if (defaultCategoryId !== counterparty.defaultCategoryId)
    phrases.push(
      defaultCategoryId === null
        ? "remove the default category"
        : `set the default category to ${yield* known(namesIn(reference).category(defaultCategoryId))}`,
    );
  if (defaultRole !== counterparty.defaultRole)
    phrases.push(
      defaultRole === null
        ? "remove the default role"
        : `set the default role to ${financialRoleLabels[defaultRole]}`,
    );
  if (phrases.length === 0) return yield* unchanged(counterparty.name);
  return yield* counterpartyChangeProposal(
    api,
    counterparty,
    {
      change: {
        kind: "update",
        counterpartyId: counterparty.id,
        expectedVersion: counterparty.version,
        fields: {
          name: counterparty.name,
          kind: counterparty.kind,
          brand: counterparty.brand,
          defaultRole,
          defaultCategoryId,
        },
      },
      before: Struct.pick(counterparty, ["defaultRole", "defaultCategoryId"]),
    },
    `${sentence(listed(phrases))} for ${counterparty.name}`,
  );
});

// A default for one reference on payments with a counterparty, found in the counterparty
// as it is now. The title names the reference by its counterparty, since the reference is
// the bank's text.
const referenceDefaultProposal = Effect.fnUntraced(function* (
  api: ProposalApi,
  detail: typeof CounterpartyDetail.Type,
  row: typeof CounterpartyReference.Type,
  defaults: Pick<
    typeof ProposalIntent.cases.referenceDefault.Type,
    "defaultRole" | "defaultCategoryId"
  >,
) {
  const { counterparty } = detail;
  if (
    row.version !== null &&
    row.defaultRole === defaults.defaultRole &&
    row.defaultCategoryId === defaults.defaultCategoryId
  )
    return yield* unchanged(`the reference default for ${counterparty.name}`);
  const role = financialRoleLabels[defaults.defaultRole];
  const category =
    defaults.defaultCategoryId === null
      ? null
      : yield* known(namesIn(yield* api.getReferenceData()).category(defaults.defaultCategoryId));
  return yield* counterpartyChangeProposal(
    api,
    counterparty,
    {
      change: {
        kind: "saveReference",
        counterpartyId: counterparty.id,
        referenceKey: row.referenceKey,
        expectedVersion: row.version,
        ...defaults,
      },
      before: Struct.pick(row, ["defaultRole", "defaultCategoryId"]),
    },
    `Set a reference default for ${counterparty.name}: ${category === null ? role : `${role}, ${category}`}`,
  );
});

// Previews what the analyst proposed against the records as they are now.
export const proposalFor = (api: ProposalApi) =>
  Effect.fn("proposalFor")(function* (intent: ProposalIntent) {
    switch (intent.kind) {
      case "transaction":
        return yield* transactionProposal(api, intent);
      case "counterpartyDefault":
        return yield* counterpartyDefaultProposal(api, intent);
      case "referenceDefault": {
        const detail = yield* api.getCounterparty({ counterpartyId: intent.counterpartyId });
        const row = detail.references.find((item) => item.referenceKey === intent.referenceKey);
        if (!row)
          return yield* new FinanceError({
            kind: "notFound",
            message: `No payment with ${detail.counterparty.name} carries this reference any more.`,
          });
        return yield* referenceDefaultProposal(api, detail, row, intent);
      }
    }
  });

// Stores a pending proposal for the turn once its reason passes the answer's checks, and
// tells the model its ID and title.
const propose = Effect.fnUntraced(function* (
  intent: ProposalIntent,
  reason: string,
  previewed: Effect.Effect<Previewed, FinanceError>,
) {
  const evidence = yield* TurnEvidence;
  const problems = checkAgainst(yield* evidence.snapshot)(reason);
  if (problems.length > 0)
    return yield* new FinanceError({
      kind: "invalid",
      message: `The reason cannot be shown. ${problems.join(" ")}`,
    });
  const { preview, title, step } = yield* previewed;
  yield* evidence.step(step);
  return { proposalId: yield* evidence.propose({ intent, preview, title, reason }), title };
});

const Reason = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(500));
const Proposed = Schema.Struct({ proposalId: ProposalId, title: Schema.String });
const proposing =
  "The proposal shows below your answer with its effect on each month, and nothing " +
  "changes until the person accepts it. Give your reason in words, in the answer " +
  "grammar; it may cite this turn's figure and record tokens. Proposing again makes " +
  "another proposal.";

export const ProposeTransactionChange = Tool.make("ProposeTransactionChange", {
  description:
    "Propose a change to one transaction that is not split: its role, its category, " +
    "whether it is non-personal (not your spending, such as a work expense), its tags and " +
    "personal events, or its purchase date. Name only what changes, with the IDs " +
    `ReadCategories returns; null removes a category or purchase date. ${proposing}`,
  parameters: Schema.Struct({
    ...Struct.omit(ProposalIntent.cases.transaction.fields, ["kind"]),
    reason: Reason,
  }),
  success: Proposed,
  failure: FinanceError,
  failureMode: "return",
  dependencies: [TurnEvidence],
});

export const proposeTransactionChange = (api: ProposalApi) =>
  Effect.fn("ProposeTransactionChange")(function* ({
    reason,
    ...change
  }: Tool.Parameters<typeof ProposeTransactionChange>) {
    const intent = { kind: "transaction", ...change } satisfies ProposalIntent;
    return yield* propose(intent, reason, proposalFor(api)(intent));
  });

export const ProposeCounterpartyDefault = Tool.make("ProposeCounterpartyDefault", {
  description:
    "Propose a counterparty's default role or category, which its transactions follow " +
    "unless a rule or the person set theirs. Name only the defaults that change; null " +
    `removes one. Take category IDs from ReadCategories. ${proposing}`,
  parameters: Schema.Struct({
    ...Struct.omit(ProposalIntent.cases.counterpartyDefault.fields, ["kind"]),
    reason: Reason,
  }),
  success: Proposed,
  failure: FinanceError,
  failureMode: "return",
  dependencies: [TurnEvidence],
});

export const proposeCounterpartyDefault = (api: ProposalApi) =>
  Effect.fn("ProposeCounterpartyDefault")(function* ({
    reason,
    ...defaults
  }: Tool.Parameters<typeof ProposeCounterpartyDefault>) {
    const intent = { kind: "counterpartyDefault", ...defaults } satisfies ProposalIntent;
    return yield* propose(intent, reason, proposalFor(api)(intent));
  });

export const ProposeReferenceDefault = Tool.make("ProposeReferenceDefault", {
  description:
    "Propose what payments with one counterparty and one reference are, ahead of the " +
    "counterparty's defaults, such as rent paid to a person you also repay for dinners. " +
    "Pass the reference as ReadCounterparty lists it. A transfer has no category. " +
    proposing,
  parameters: Schema.Struct({
    ...Struct.omit(ProposalIntent.cases.referenceDefault.fields, ["kind", "referenceKey"]),
    reference: Schema.String,
    reason: Reason,
  }),
  success: Proposed,
  failure: FinanceError,
  failureMode: "return",
  dependencies: [TurnEvidence],
});

export const proposeReferenceDefault = (api: ProposalApi) =>
  Effect.fn("ProposeReferenceDefault")(function* ({
    reason,
    reference,
    ...defaults
  }: Tool.Parameters<typeof ProposeReferenceDefault>) {
    const detail = yield* api.getCounterparty({ counterpartyId: defaults.counterpartyId });
    const row = detail.references.find(
      (item) => item.sample === reference || item.referenceKey === reference,
    );
    if (!row)
      return yield* new FinanceError({
        kind: "notFound",
        message: `No payment with ${detail.counterparty.name} carries that reference. Pass one as ReadCounterparty lists it.`,
      });
    return yield* propose(
      { kind: "referenceDefault", ...defaults, referenceKey: row.referenceKey },
      reason,
      referenceDefaultProposal(
        api,
        detail,
        row,
        Struct.pick(defaults, ["defaultRole", "defaultCategoryId"]),
      ),
    );
  });
