import { CategoryId, CounterpartyFields, PersonRole, ReferenceData } from "@repo/contracts/finance";
import { Schema, Struct } from "effect";

// A counterparty you already have, or a new one by name.
const Identity = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("existing"),
    counterparty: ReferenceData.fields.counterparties.value,
  }),
  Schema.Struct({ kind: Schema.Literal("new"), name: CounterpartyFields.fields.name }),
]);

// Who is behind a descriptor or a proposed counterparty, and for someone new, what they
// are. Payments with a person need a role to mean anything, so a new person without one
// would leave the question open.
export const IdentifyAnswer = Schema.Struct({
  identity: Schema.NullOr(Identity).check(
    Schema.makeFilter(
      (identity) => identity !== null || "Choose who it is, or type a name to add them.",
    ),
  ),
  ...Struct.pick(CounterpartyFields.fields, ["kind", "defaultRole", "defaultCategoryId"]),
}).check(
  Schema.makeFilter(
    (answer) =>
      answer.identity?.kind !== "new" ||
      answer.kind !== "person" ||
      Schema.is(PersonRole)(answer.defaultRole) || {
        path: ["defaultRole"],
        issue: "Choose what payments with them are.",
      },
  ),
);

// What payments with a person are, when you answer other than the proposal.
export const PersonAnswerFields = Schema.Struct({
  role: Schema.NullOr(PersonRole).check(
    Schema.makeFilter((role) => role !== null || "Choose what these payments are."),
  ),
  categoryId: Schema.NullOr(CategoryId),
});
