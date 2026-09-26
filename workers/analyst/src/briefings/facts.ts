import { Basis, Figure, Limit, RecordRef } from "@repo/contracts/analyst";
import { FinanceError, type YearMonth } from "@repo/contracts/finance";
import { Crypto, Effect, Encoding, Schema, Struct } from "effect";

import { basisOf } from "../evidence/basis.ts";
import { TurnEvidence } from "../evidence/service.ts";
import { type AnalystToolkit, readAs } from "../tools/toolkit.ts";

// What a fingerprint covers: the figures, records, basis, and limits the reads registered,
// without when the API calculated them. The rest of what the reads return, such as the
// dates and descriptions of a question's transactions and the files that failed to import,
// reaches beyond the month, so a change outside it never writes the briefing again.
const Fingerprinted = Schema.Struct({
  figures: Schema.Array(Schema.Struct(Struct.omit(Figure.fields, ["calculatedAt"]))),
  records: Schema.Array(RecordRef),
  basis: Schema.NullOr(Schema.Struct(Struct.omit(Basis.fields, ["calculatedAt"]))),
  limits: Schema.Array(Limit),
});
// The schemas order each object's keys, so the same facts encode to the same text.
const encodeFingerprinted = Schema.encodeEffect(
  Schema.fromJsonString(Schema.toCodecJson(Fingerprinted)),
);

// What a month's briefing is written from, read with the tools the model reads with, as if
// it had called them: the month's flow against the month before, its open questions, and
// which of its days have records, with the files whose import failed or waits for review.
// The reads run one after another, so their figures take the same numbers every time.
export const readBriefingMonth = Effect.fn("readBriefingMonth")(function* (
  toolkit: Effect.Success<typeof AnalystToolkit>,
  month: YearMonth,
) {
  const period = { kind: "months", from: month, to: month } as const;
  return [
    yield* readAs(toolkit, "ReadFlow", { period, comparison: { kind: "previous" } }, "flow"),
    yield* readAs(toolkit, "ListQuestions", { period, filter: null }, "questions"),
    yield* readAs(toolkit, "ReadCoverage", { period }, "coverage"),
  ];
});

// The month's reads, and the SHA-256 fingerprint of the facts they registered, which the
// same facts always give.
export const readBriefingFacts = Effect.fn("readBriefingFacts")(function* (
  toolkit: Effect.Success<typeof AnalystToolkit>,
  month: YearMonth,
) {
  const reads = yield* readBriefingMonth(toolkit, month);
  for (const { result } of reads)
    if (result.isFailure)
      return yield* Schema.is(FinanceError)(result.result)
        ? Effect.fail(result.result)
        : Effect.die(result.result);
  const evidence = yield* (yield* TurnEvidence).snapshot;
  const basis = basisOf(
    evidence.currency,
    [...new Set([...evidence.placed.values(), ...evidence.checks])],
    evidence.accounts,
  );
  const text = yield* encodeFingerprinted({
    figures: evidence.figures.map(Struct.omit(["calculatedAt"])),
    records: evidence.records,
    basis: basis && Struct.omit(basis, ["calculatedAt"]),
    limits: evidence.limits,
  });
  const digest = yield* (yield* Crypto.Crypto)
    .digest("SHA-256", new TextEncoder().encode(text))
    .pipe(Effect.orDie);
  return {
    messages: reads.flatMap(({ messages }) => messages),
    evidence,
    fingerprint: Encoding.encodeHex(digest),
  };
});
