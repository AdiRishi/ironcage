import type {
  CategoryId,
  ModelBasis,
  PersonRole,
  Question,
  ReferenceData,
} from "@repo/contracts/finance";
import { addDays, periodLabel } from "@repo/finance";

type Categories = (typeof ReferenceData.Type)["categories"];
type PersonQuestion = Extract<Question, { kind: "person" }>;

// "ACCOUNT 9921" is the alias key of transfers to an account ending 9921.
export const accountName = (aliasKey: string) =>
  `Account ending ${aliasKey.replace(/^ACCOUNT /, "")}`;

export const categoryName = (categories: Categories, id: typeof CategoryId.Type) =>
  categories.find((category) => category.id === id)?.name ?? "a removed category";

// The days a question's transactions posted on, such as "3 August 2026" for one.
export const affectedDates = ({ affects }: Question) =>
  periodLabel({ start: affects.firstOn, endExclusive: addDays(affects.lastOn, 1) });

// The payments a person question covers. Its reference key leaves out the dates and
// numbers that change from one payment to the next, so "Rent Aug" stands for "Rent Sept"
// too.
export const markedLike = (reference: NonNullable<PersonQuestion["reference"]>) =>
  `marked like “${reference.sample}”`;

// What a question asks, as its card's heading. Questions about one transaction name it,
// so no two headings are the same.
export function questionTitle(question: Question) {
  switch (question.kind) {
    case "counterparty":
      return `Is this ${question.counterparty.name}?`;
    case "alias":
      return `Is “${question.aliasKey}” ${question.counterparty.name}?`;
    case "person":
      return question.reference
        ? `What are payments with ${question.counterparty.name} ${markedLike(question.reference)}?`
        : `What are payments with ${question.counterparty.name}?`;
    case "ownAccount":
      return `Whose is the ${accountName(question.aliasKey).toLowerCase()}?`;
    case "unresolved":
      return question.subject.kind === "alias"
        ? `Who is “${question.subject.aliasKey}”?`
        : `What is “${question.samples[0].description}” on ${affectedDates(question)}?`;
    case "ruleConflict": {
      const rules = question.rules.length === 2 ? "Two rules" : `${question.rules.length} rules`;
      return `${rules} disagree about “${question.samples[0].description}” on ${affectedDates(question)}`;
    }
  }
}

// What payments proposed to take a role and category are, such as "spending in Rent".
export function roleText(
  role: PersonRole,
  categoryId: typeof CategoryId.Type | null,
  categories: Categories,
) {
  const category = categoryId && categoryName(categories, categoryId);
  switch (role) {
    case "purchase":
      return category ? `spending in ${category}` : "spending";
    case "reimbursement":
      return category ? `paying you back for ${category}` : "paying you back";
    case "income":
      return category ? `income in ${category}` : "income";
    case "refund":
      return category ? `refunds in ${category}` : "refunds";
  }
}

export const modelText = (basis: typeof ModelBasis.Type) =>
  `The model: ${basis.reason} ${Math.round(basis.confidence * 100)}% sure.`;
