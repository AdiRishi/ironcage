import { expect, it } from "@effect/vitest";
import {
  CalendarDate,
  ObservationId,
  PostingId,
  SourceFileId,
  type Candidate,
} from "@repo/contracts/finance";

import { matchObservations, type MatchingObservation, type MatchingPosting } from "../src/index.ts";

const match = (
  observations: ReadonlyArray<MatchingObservation>,
  postings: ReadonlyArray<MatchingPosting>,
  order: "ascending" | "descending" = "descending",
) => matchObservations({ sourceFileId: source, observations, postings, order, complete: true });

const source = SourceFileId.make("00000000-0000-4000-8000-000000000001");
const priorSource = SourceFileId.make("00000000-0000-4000-8000-000000000002");
const first = PostingId.make("00000000-0000-4000-8000-000000000011");
const second = PostingId.make("00000000-0000-4000-8000-000000000012");
const rowOne = ObservationId.make("00000000-0000-4000-8000-000000000021");
const rowTwo = ObservationId.make("00000000-0000-4000-8000-000000000022");
const coffee: Candidate = {
  postedOn: CalendarDate.make("2026-09-02"),
  valueOn: null,
  amount: { currency: "AUD", minor: -450n },
  description: "Coffee",
  balance: null,
  bankId: null,
  originalMoney: null,
};
function row(id: typeof ObservationId.Type, candidate: Candidate = coffee): MatchingObservation {
  return { id, locatorKey: id, candidate, decision: null };
}
function posting(id: typeof PostingId.Type, candidate: Candidate = coffee): MatchingPosting {
  return {
    id,
    candidate,
    evidence: [{ sourceFileId: priorSource, locatorKey: id, order: "descending", candidate }],
  };
}

it("two identical transactions in a new file create two postings", () => {
  expect(match([row(rowOne), row(rowTwo)], [])).toEqual({
    assignments: [
      { observationId: rowOne, postingId: null, method: "new" },
      { observationId: rowTwo, postingId: null, method: "new" },
    ],
    questions: [],
  });
});
it("two identical transactions in another complete file support the two existing postings", () => {
  expect(match([row(rowOne), row(rowTwo)], [posting(first), posting(second)])).toEqual({
    assignments: [
      { observationId: rowOne, postingId: first, method: "group" },
      { observationId: rowTwo, postingId: second, method: "group" },
    ],
    questions: [],
  });
});
it("running balances disambiguate repeated descriptions before assigning either row", () => {
  const before = { ...coffee, balance: { currency: "AUD", minor: 10000n } };
  const after = { ...coffee, balance: { currency: "AUD", minor: 9550n } };
  expect(
    match(
      [row(rowOne, after), row(rowTwo, before)],
      [posting(first, before), posting(second, after)],
    ),
  ).toEqual({
    assignments: [
      { observationId: rowOne, postingId: second, method: "group" },
      { observationId: rowTwo, postingId: first, method: "group" },
    ],
    questions: [],
  });
});
it("a single coffee cannot choose between two identical postings", () => {
  expect(match([row(rowOne)], [posting(first), posting(second)])).toEqual({
    assignments: [],
    questions: [
      {
        kind: "duplicate",
        reason: "ambiguousGroup",
        observationIds: [rowOne],
        postingIds: [first, second],
      },
    ],
  });
});
it("unequal groups accept a single corroborated pair", () => {
  expect(
    match([row(rowOne)], [posting(first, { ...coffee, description: "Bus" }), posting(second)]),
  ).toEqual({
    assignments: [{ observationId: rowOne, postingId: second, method: "corroborated" }],
    questions: [],
  });
});
it("equal counts do not pair distinguishable rows with different wording", () => {
  const result = match(
    [
      row(rowOne, { ...coffee, description: "Bakery purchase" }),
      row(rowTwo, { ...coffee, description: "Cafe purchase" }),
    ],
    [
      posting(first, { ...coffee, description: "Merchant A" }),
      posting(second, { ...coffee, description: "Merchant B" }),
    ],
  );
  expect(result.assignments).toEqual([]);
  expect(result.questions).toEqual([
    {
      kind: "duplicate",
      reason: "ambiguousGroup",
      observationIds: [rowOne, rowTwo],
      postingIds: [first, second],
    },
  ]);
});
it("a single statement row can support a single structured posting despite different wording", () => {
  expect(
    match([row(rowOne, { ...coffee, description: "Card purchase at cafe" })], [posting(first)]),
  ).toEqual({
    assignments: [{ observationId: rowOne, postingId: first, method: "group" }],
    questions: [],
  });
});
it("equal descriptions cannot override conflicting running balances", () => {
  expect(
    match(
      [row(rowOne, { ...coffee, balance: { currency: "AUD", minor: 9000n } })],
      [posting(first, { ...coffee, balance: { currency: "AUD", minor: 10000n } })],
    ),
  ).toEqual({
    assignments: [],
    questions: [
      {
        kind: "duplicate",
        reason: "conflictingBalances",
        observationIds: [rowOne],
        postingIds: [first],
      },
    ],
  });
});
it("a reparse changing an accepted source row asks for a bank-field correction", () => {
  const existing: MatchingPosting = {
    ...posting(first),
    evidence: [
      { sourceFileId: source, locatorKey: rowOne, order: "descending", candidate: coffee },
    ],
  };
  expect(match([row(rowOne, { ...coffee, description: "Different reading" })], [existing])).toEqual(
    {
      assignments: [],
      questions: [
        {
          kind: "source_conflict",
          reason: "changedSource",
          observationIds: [rowOne],
          postingIds: [first],
        },
      ],
    },
  );
});
it("an unchanged source row stays linked when another source supplies the display wording", () => {
  const existing: MatchingPosting = {
    ...posting(first, { ...coffee, description: "Structured coffee description" }),
    evidence: [
      { sourceFileId: source, locatorKey: rowOne, order: "descending", candidate: coffee },
    ],
  };
  expect(match([row(rowOne)], [existing])).toEqual({
    assignments: [{ observationId: rowOne, postingId: first, method: "sameRow" }],
    questions: [],
  });
});
it("a reused bank ID with changed booked fields goes to value review", () => {
  expect(
    match(
      [row(rowOne, { ...coffee, bankId: "bank-123", amount: { currency: "AUD", minor: -550n } })],
      [posting(first, { ...coffee, bankId: "bank-123" })],
    ),
  ).toEqual({
    assignments: [],
    questions: [
      { kind: "value", reason: "changedBankId", observationIds: [rowOne], postingIds: [first] },
    ],
  });
});
it("a user-declared distinct transaction remains distinct on a reparse", () => {
  const accepted: MatchingPosting = {
    ...posting(second),
    evidence: [
      { sourceFileId: source, locatorKey: rowOne, order: "descending", candidate: coffee },
    ],
  };
  const input: MatchingObservation = { ...row(rowOne), decision: { kind: "distinct" } };
  expect(match([input], [posting(first), accepted])).toEqual({
    assignments: [{ observationId: rowOne, postingId: second, method: "user" }],
    questions: [],
  });
});
it("the user's chosen posting takes precedence over automatic pairing", () => {
  const selected = posting(second);
  const input: MatchingObservation = {
    ...row(rowOne),
    decision: { kind: "match", posting: selected },
  };
  expect(match([input], [posting(first), selected])).toEqual({
    assignments: [{ observationId: rowOne, postingId: second, method: "user" }],
    questions: [],
  });
});

it("an export without balances preserves the shared source order of repeated purchases", () => {
  const firstPosting = posting(first, { ...coffee, balance: { currency: "AUD", minor: 9550n } });
  const secondPosting = posting(second, { ...coffee, balance: { currency: "AUD", minor: 10000n } });
  const result = match([row(rowOne), row(rowTwo)], [secondPosting, firstPosting]);
  expect(result.questions).toHaveLength(0);
  expect(result.assignments.map((assignment) => assignment.postingId)).toEqual([first, second]);
});
it("opposite statement order reverses an otherwise identical repeated group", () => {
  const result = match([row(rowOne), row(rowTwo)], [posting(first), posting(second)], "ascending");
  expect(result.questions).toHaveLength(0);
  expect(result.assignments.map((assignment) => assignment.postingId)).toEqual([second, first]);
});
