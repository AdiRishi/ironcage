import { Schema } from "effect";

import { Instant, YearMonth } from "../finance/values.ts";
import { Basis, Limit } from "./basis.ts";
import { Figure, RecordRef } from "./references.ts";

// What came in, what went out, what changed from the month before, and what needs an
// answer, each in the answer grammar.
export const BriefingSections = Schema.Struct({
  cameIn: Schema.String,
  wentOut: Schema.String,
  changed: Schema.String,
  needsAnswer: Schema.String,
});
export type BriefingSections = typeof BriefingSections.Type;

// `ready` only while the figures the briefing was written from are the ledger's figures
// now. `writing` while a write waits or runs, and while the figures of a written briefing
// move in a facts rebuild; the first read after the rebuild writes it again if they
// changed. `blocked` means the analyst is off or model usage reached the warning, and
// `failed` that the last write could not finish; both say why in `message`. `none` means
// no briefing of the month was asked for.
export const BriefingStatus = Schema.Literals(["ready", "writing", "blocked", "failed", "none"]);
export type BriefingStatus = typeof BriefingStatus.Type;

// A month's briefing. Only a `ready` briefing has sections, the figures and records
// they cite, and the basis and limits of what they show.
export const Briefing = Schema.Struct({
  month: YearMonth,
  status: BriefingStatus,
  sections: Schema.NullOr(BriefingSections),
  figures: Schema.Array(Figure),
  records: Schema.Array(RecordRef),
  basis: Schema.NullOr(Basis),
  limits: Schema.Array(Limit),
  writtenAt: Schema.NullOr(Instant),
  message: Schema.NullOr(Schema.String),
});
export type Briefing = typeof Briefing.Type;

export const BriefingInput = Schema.Struct({ month: YearMonth });
export type BriefingInput = typeof BriefingInput.Type;

// A briefing as the list of recent months shows it, without reading the ledger again, so
// a `ready` one is checked against the current figures only when it is opened.
export const BriefingSummary = Schema.Struct({
  month: YearMonth,
  status: BriefingStatus.pick(["ready", "writing", "blocked", "failed"]),
  writtenAt: Schema.NullOr(Instant),
});
export type BriefingSummary = typeof BriefingSummary.Type;
