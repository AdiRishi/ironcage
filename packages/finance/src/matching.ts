import {
  Candidate,
  type MatchMethod,
  type ObservationId,
  PostingId,
  SourceFileId,
  Statement,
} from "@repo/contracts/finance";
import { Schema } from "effect";

export const MatchingPosting = Schema.Struct({
  id: PostingId,
  candidate: Candidate,
  evidence: Schema.Array(
    Schema.Struct({
      sourceFileId: SourceFileId,
      locatorKey: Schema.String,
      order: Statement.fields.order,
      candidate: Candidate,
    }),
  ),
});
export type MatchingPosting = typeof MatchingPosting.Type;
export interface MatchingObservation {
  readonly id: typeof ObservationId.Type;
  readonly locatorKey: string;
  readonly candidate: Candidate;
  readonly decision:
    | { readonly kind: "match"; readonly posting: MatchingPosting }
    | { readonly kind: "distinct" }
    | null;
}
export type MatchAssignment =
  | {
      readonly observationId: typeof ObservationId.Type;
      readonly postingId: typeof PostingId.Type;
      readonly method: Exclude<MatchMethod, "new">;
    }
  | {
      readonly observationId: typeof ObservationId.Type;
      readonly postingId: null;
      readonly method: "new" | "user";
    };
interface MatchQuestion {
  readonly kind: "source_conflict" | "value" | "duplicate";
  readonly reason: "changedSource" | "changedBankId" | "ambiguousGroup" | "conflictingBalances";
  readonly observationIds: ReadonlyArray<typeof ObservationId.Type>;
  readonly postingIds: ReadonlyArray<typeof PostingId.Type>;
}
const sameMoney = (left: Candidate["amount"] | null, right: Candidate["amount"] | null) =>
  left === null
    ? right === null
    : right !== null && left.currency === right.currency && left.minor === right.minor;
const sameBookedFields = (left: Candidate, right: Candidate) =>
  left.postedOn === right.postedOn &&
  left.valueOn === right.valueOn &&
  sameMoney(left.amount, right.amount) &&
  left.description === right.description &&
  sameMoney(left.originalMoney, right.originalMoney);
export const decodeEntities = (text: string) =>
  text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const normalizedDescription = (description: string) =>
  decodeEntities(description).replace(/\s+/g, " ").trim();
const matchKey = (candidate: Candidate) =>
  `${candidate.amount.currency}/${candidate.postedOn}/${candidate.amount.minor}`;
export const sameMatchKey = (left: Candidate, right: Candidate) =>
  matchKey(left) === matchKey(right);
const balanceConflict = (observation: Candidate, posting: MatchingPosting) =>
  observation.balance !== null &&
  posting.evidence.some(
    (item) =>
      item.candidate.balance !== null && !sameMoney(observation.balance, item.candidate.balance),
  );
const equalBalance = (observation: Candidate, posting: MatchingPosting) =>
  observation.balance !== null &&
  posting.evidence.some((item) => sameMoney(observation.balance, item.candidate.balance));
const equalDescription = (observation: Candidate, posting: MatchingPosting) =>
  posting.evidence.some(
    (item) =>
      normalizedDescription(observation.description) ===
      normalizedDescription(item.candidate.description),
  );
const indistinguishable = (candidates: ReadonlyArray<Candidate>) => {
  const first = candidates[0];
  const balances = candidates.flatMap((candidate) =>
    candidate.balance ? [candidate.balance] : [],
  );
  return (
    first !== undefined &&
    candidates.every(
      (candidate) =>
        normalizedDescription(candidate.description) === normalizedDescription(first.description),
    ) &&
    balances.every((balance) => sameMoney(balance, balances[0] ?? null))
  );
};

export function matchObservations({
  sourceFileId,
  observations,
  postings,
  order,
  complete,
}: {
  readonly sourceFileId: typeof SourceFileId.Type;
  readonly observations: ReadonlyArray<MatchingObservation>;
  readonly postings: ReadonlyArray<MatchingPosting>;
  readonly order: Statement["order"];
  /** False when an unreadable row means the file's row count cannot be trusted. */
  readonly complete: boolean;
}) {
  const assignments: MatchAssignment[] = [];
  const questions: MatchQuestion[] = [];
  const matchedRows = new Set<typeof ObservationId.Type>();
  const matchedPostings = new Set<typeof PostingId.Type>();
  const existingRows = new Map(
    postings.flatMap((posting) =>
      posting.evidence
        .filter((item) => item.sourceFileId === sourceFileId)
        .map((item) => [item.locatorKey, { posting, candidate: item.candidate }] as const),
    ),
  );
  const postingsByKey = Map.groupBy(postings, (posting) => matchKey(posting.candidate));
  const postingsByBankId = new Map<string, Set<MatchingPosting>>();
  for (const posting of postings)
    for (const evidence of posting.evidence) {
      if (!evidence.candidate.bankId) continue;
      const group = postingsByBankId.get(evidence.candidate.bankId);
      if (group) group.add(posting);
      else postingsByBankId.set(evidence.candidate.bankId, new Set([posting]));
    }
  const link = (
    observation: MatchingObservation,
    posting: MatchingPosting,
    method: Exclude<MatchMethod, "new">,
  ) => {
    matchedRows.add(observation.id);
    matchedPostings.add(posting.id);
    assignments.push({ observationId: observation.id, postingId: posting.id, method });
  };
  const create = (observation: MatchingObservation, method: "new" | "user") => {
    matchedRows.add(observation.id);
    assignments.push({ observationId: observation.id, postingId: null, method });
  };
  const ask = (
    kind: MatchQuestion["kind"],
    reason: MatchQuestion["reason"],
    rows: ReadonlyArray<MatchingObservation>,
    choices: ReadonlyArray<MatchingPosting>,
  ) => {
    for (const row of rows) matchedRows.add(row.id);
    for (const posting of choices) matchedPostings.add(posting.id);
    questions.push({
      kind,
      reason,
      observationIds: rows.map((row) => row.id),
      postingIds: choices.map((posting) => posting.id),
    });
  };
  for (const observation of observations) {
    const sameRow = existingRows.get(observation.locatorKey);
    if (observation.decision?.kind === "match") {
      link(observation, observation.decision.posting, "user");
      continue;
    }
    if (observation.decision?.kind === "distinct") {
      if (sameRow) link(observation, sameRow.posting, "user");
      else create(observation, "user");
      continue;
    }
    if (sameRow) {
      if (sameBookedFields(observation.candidate, sameRow.candidate))
        link(observation, sameRow.posting, "sameRow");
      else ask("source_conflict", "changedSource", [observation], [sameRow.posting]);
      continue;
    }
    if (observation.candidate.bankId) {
      const matches = Array.from(postingsByBankId.get(observation.candidate.bankId) ?? []);
      const only = matches[0];
      if (matches.length === 1 && only) {
        if (sameMatchKey(observation.candidate, only.candidate) && !matchedPostings.has(only.id))
          link(observation, only, "bankId");
        else ask("value", "changedBankId", [observation], matches);
      } else if (matches.length > 1) ask("value", "changedBankId", [observation], matches);
    }
  }
  const groups = new Map<string, MatchingObservation[]>();
  for (const row of observations) {
    if (matchedRows.has(row.id)) continue;
    const groupKey = matchKey(row.candidate);
    const group = groups.get(groupKey);
    if (group) group.push(row);
    else groups.set(groupKey, [row]);
  }
  for (const [groupKey, group] of groups) {
    const existing = (postingsByKey.get(groupKey) ?? []).filter(
      (posting) => !matchedPostings.has(posting.id),
    );
    if (existing.length === 0) {
      for (const row of group) create(row, "new");
      continue;
    }
    if (group.length !== existing.length || !complete) {
      const corroborated = group.flatMap((row) =>
        existing
          .filter(
            (posting) =>
              !balanceConflict(row.candidate, posting) &&
              (equalDescription(row.candidate, posting) || equalBalance(row.candidate, posting)),
          )
          .map((posting) => ({ row, posting })),
      );
      if (corroborated.length === 1 && corroborated[0])
        link(corroborated[0].row, corroborated[0].posting, "corroborated");
    } else {
      const pairUnique = (
        supports: (row: MatchingObservation, posting: MatchingPosting) => boolean,
      ) => {
        const remainingRows = group.filter((row) => !matchedRows.has(row.id));
        const remainingPostings = existing.filter((posting) => !matchedPostings.has(posting.id));
        const pairs = remainingRows.flatMap((row) =>
          remainingPostings
            .filter((posting) => !balanceConflict(row.candidate, posting) && supports(row, posting))
            .map((posting) => ({ row, posting })),
        );
        for (const pair of pairs) {
          if (
            pairs.filter((other) => other.row.id === pair.row.id).length === 1 &&
            pairs.filter((other) => other.posting.id === pair.posting.id).length === 1
          )
            link(pair.row, pair.posting, "group");
        }
      };
      pairUnique(
        (row, posting) =>
          equalDescription(row.candidate, posting) && equalBalance(row.candidate, posting),
      );
      pairUnique((row, posting) => equalDescription(row.candidate, posting));
      pairUnique((row, posting) => equalBalance(row.candidate, posting));
      const remainingRows = group.filter((row) => !matchedRows.has(row.id));
      const remainingPostings = existing.filter((posting) => !matchedPostings.has(posting.id));
      const postingCandidates = remainingPostings.map((posting) => ({
        ...posting.candidate,
        balance:
          posting.evidence.find((item) => item.candidate.balance !== null)?.candidate.balance ??
          null,
      }));
      const balancesOnBothSides =
        remainingRows.some((row) => row.candidate.balance !== null) &&
        postingCandidates.some((candidate) => candidate.balance !== null);
      const commonSource = remainingPostings[0]?.evidence.find((evidence) =>
        remainingPostings.every((posting) =>
          posting.evidence.some((item) => item.sourceFileId === evidence.sourceFileId),
        ),
      );
      const orderedPostings = commonSource
        ? remainingPostings.toSorted((left, right) => {
            const leftRow = left.evidence.find(
              (item) => item.sourceFileId === commonSource.sourceFileId,
            );
            const rightRow = right.evidence.find(
              (item) => item.sourceFileId === commonSource.sourceFileId,
            );
            return (
              (leftRow?.locatorKey ?? "").localeCompare(rightRow?.locatorKey ?? "", "en", {
                numeric: true,
              }) * (commonSource.order === order ? 1 : -1)
            );
          })
        : remainingPostings;
      const comparableRows = remainingRows.map((row) =>
        balancesOnBothSides ? row.candidate : { ...row.candidate, balance: null },
      );
      const comparablePostings = postingCandidates.map((candidate) =>
        balancesOnBothSides ? candidate : { ...candidate, balance: null },
      );
      if (
        (balancesOnBothSides || commonSource || remainingPostings.length === 1) &&
        indistinguishable(comparableRows) &&
        indistinguishable(comparablePostings) &&
        remainingRows.every((row) =>
          remainingPostings.every((posting) => !balanceConflict(row.candidate, posting)),
        )
      ) {
        for (const [index, row] of remainingRows.entries()) {
          const posting = orderedPostings[index];
          if (posting) link(row, posting, "group");
        }
      }
    }
    const unresolved = group.filter((row) => !matchedRows.has(row.id));
    const choices = existing.filter((posting) => !matchedPostings.has(posting.id));
    if (choices.length === 0) {
      for (const row of unresolved) create(row, "new");
    } else if (unresolved.length > 0)
      ask(
        "duplicate",
        unresolved.some((row) => choices.some((posting) => balanceConflict(row.candidate, posting)))
          ? "conflictingBalances"
          : "ambiguousGroup",
        unresolved,
        choices,
      );
  }
  return { assignments, questions };
}
