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

// A month's briefing. `ready` only while the figures it was written from are the ledger's
// figures now, with its sections, the figures and records they cite, and the basis and
// limits of what they show. `writing` while a write waits or runs, and while the figures
// of a written briefing move in a facts rebuild; the first read after the rebuild writes
// it again if they changed. `blocked` means the analyst is off or model usage reached the
// warning, and `failed` that the last write could not finish; both say why in `message`.
// `none` means no briefing of the month was asked for.
export const Briefing = Schema.Union([
  Schema.Struct({
    month: YearMonth,
    status: Schema.Literal("ready"),
    sections: BriefingSections,
    figures: Schema.Array(Figure),
    records: Schema.Array(RecordRef),
    basis: Schema.NullOr(Basis),
    limits: Schema.Array(Limit),
    writtenAt: Instant,
  }),
  Schema.Struct({ month: YearMonth, status: Schema.Literals(["writing", "none"]) }),
  Schema.Struct({
    month: YearMonth,
    status: Schema.Literals(["blocked", "failed"]),
    message: Schema.String,
  }),
]);
export type Briefing = typeof Briefing.Type;

export const BriefingInput = Schema.Struct({ month: YearMonth });
export type BriefingInput = typeof BriefingInput.Type;

// A briefing as the list of recent months shows it, without reading the ledger again, so
// a `ready` one is checked against the current figures only when it is opened.
export const BriefingSummary = Schema.Union([
  Schema.Struct({ month: YearMonth, status: Schema.Literal("ready"), writtenAt: Instant }),
  Schema.Struct({ month: YearMonth, status: Schema.Literals(["writing", "blocked", "failed"]) }),
]);
export type BriefingSummary = typeof BriefingSummary.Type;
