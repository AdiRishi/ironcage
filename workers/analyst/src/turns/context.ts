import type { AskContext } from "@repo/contracts/analyst";
import { Effect, Struct } from "effect";
import type { Tool } from "effect/unstable/ai";

import { readBriefingMonth } from "../briefings/facts.ts";
import { briefingRequest, briefingText } from "../briefings/prompt.ts";
import { readBriefing } from "../storage/briefings.ts";
import { type AnalystTools, type AnalystToolkit, readAs, unavailableIn } from "../tools/toolkit.ts";
import { earlierTurn } from "./prompt.ts";

const callId = "context";

const contextReads = (toolkit: Effect.Success<typeof AnalystToolkit>, context: AskContext) => {
  const read = <Name extends keyof AnalystTools>(
    name: Name,
    params: Tool.ParametersEncoded<AnalystTools[Name]>,
  ) => readAs(toolkit, name, params, callId).pipe(Effect.map((result) => [result]));
  switch (context.kind) {
    case "category":
      return read("ReadSpending", Struct.omit(context, ["kind"]));
    case "counterparty":
      return read("ReadCounterparty", { counterpartyId: context.counterpartyId });
    case "transaction":
      return read("ReadTransaction", { postingId: context.postingId });
    // A spending stream opens Spending, and any other stream the counted ledger.
    case "stream": {
      const { measure, ...scope } = context.scope;
      return measure === "spending"
        ? read("ReadSpending", { period: context.period, comparison: context.comparison, ...scope })
        : read("ListTransactions", {
            list: { kind: "counted", scope: context.scope, period: context.period, filter: {} },
          });
    }
    // The reads a briefing is written from.
    case "briefing":
      return readBriefingMonth(toolkit, context.month);
  }
};

// Reads what the question was asked about with the tools the model would call, before the
// model is called, so the turn's first steps and figures are what the screen showed. The
// calls and their results follow the question as if the model had made them.
export const readContext = Effect.fn("readContext")(function* (
  toolkit: Effect.Success<typeof AnalystToolkit>,
  context: AskContext,
) {
  const reads = yield* contextReads(toolkit, context);
  const unavailable = unavailableIn(reads.map(({ result }) => result));
  if (unavailable) return yield* unavailable;
  return reads.flatMap(({ messages }) => messages);
});

// What the person read of what they asked about, which comes before the question like an
// earlier answer: a written briefing, with each figure as the value it showed.
export const readShown = Effect.fn("readShown")(function* (context: AskContext) {
  if (context.kind !== "briefing") return [];
  const briefing = yield* readBriefing(context.month);
  if (briefing?.status !== "ready") return [];
  return earlierTurn({
    question: briefingRequest(context.month),
    answer: {
      text: briefingText(briefing.sections),
      figures: briefing.figures,
      records: briefing.records,
    },
  });
});
