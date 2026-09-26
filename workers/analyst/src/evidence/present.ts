import type { CountUnit, FigureId, FigureValue, RecordLink } from "@repo/contracts/analyst";
import { Instant, type Money } from "@repo/contracts/finance";
import { figureText } from "@repo/finance";
import { DateTime, Effect, Schema } from "effect";

import type { CoverageRead } from "./basis.ts";
import { TurnEvidence } from "./service.ts";

// A figure as the model reads it: the token to cite, and what the answer shows in its
// place. The model reads the value to reason about the figure and never writes it.
export const FigureView = Schema.Struct({ figure: Schema.String, value: Schema.String });
export type FigureView = typeof FigureView.Type;

// When the API calculated a read's figures, and the read of the period that places them,
// which is null for figures no period places, such as one transaction's amount.
export type ReadBasis = { readonly calculatedAt: Instant; readonly placed: CoverageRead | null };

export const placedBy = (read: CoverageRead): ReadBasis => ({
  calculatedAt: read.calculatedAt,
  placed: read,
});

// When a result the API sends without a calculation time arrived, which stands for it.
export const arrived = DateTime.now.pipe(
  Effect.map((now) => Instant.make(DateTime.formatIso(now))),
);

export const money = (amount: Money): FigureValue => ({ kind: "money", amount, signed: false });
// A change, shown with its sign.
export const change = (amount: Money): FigureValue => ({ kind: "money", amount, signed: true });
export const count = (value: number, unit: typeof CountUnit.Type): FigureValue => ({
  kind: "count",
  count: value,
  unit,
});
export const share = (value: number): FigureValue => ({
  kind: "percent",
  percent: value,
  signed: false,
});
export const changePercent = (value: number): FigureValue => ({
  kind: "percent",
  percent: value,
  signed: true,
});

export const view = (id: FigureId, value: FigureValue): FigureView => ({
  figure: `[[${id}]]`,
  value: figureText(value),
});

// `modelAmount` is how much of the figure rests on the model's reading of transactions,
// and null where the model reads nothing. When some does, the answer says so beside it.
export const register = Effect.fnUntraced(function* (
  read: ReadBasis,
  label: string,
  value: FigureValue,
  records: RecordLink,
  modelAmount: Money | null = null,
) {
  const evidence = yield* TurnEvidence;
  const id = yield* evidence.figure(
    { calculatedAt: read.calculatedAt, label, value, records, modelAmount },
    read.placed,
  );
  if (modelAmount !== null && modelAmount.minor !== 0n)
    yield* evidence.limit({ kind: "modelShare", figureId: id });
  return id;
});

export const cite = Effect.fnUntraced(function* (
  read: ReadBasis,
  label: string,
  value: FigureValue,
  records: RecordLink,
  modelAmount: Money | null = null,
) {
  return view(yield* register(read, label, value, records, modelAmount), value);
});

// A transaction, counterparty, or list the answer can name, as the token to cite. The
// label is what an earlier answer shows the model in the record's place, so it never
// holds text the bank printed.
export const citeRecord = Effect.fnUntraced(function* (label: string, records: RecordLink) {
  const evidence = yield* TurnEvidence;
  return `[[${yield* evidence.record({ label, records })}]]`;
});
