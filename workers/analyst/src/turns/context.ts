import type { AskContext } from "@repo/contracts/analyst";
import { Effect, Stream, Struct } from "effect";
import type { Prompt, Tool } from "effect/unstable/ai";

import { type AnalystToolkit, unavailableIn } from "../tools/toolkit.ts";

type Tools = typeof AnalystToolkit.tools;

const callId = "context";

// Reads what the question was asked about with the tool the model would call, before the
// model is called, so the turn's first step and figures are what the screen showed. The
// call and its result open the model's prompt as if the model had made the call.
export const readContext = Effect.fn("readContext")(function* (
  toolkit: Effect.Success<typeof AnalystToolkit>,
  context: AskContext,
) {
  const read = <Name extends keyof Tools>(
    name: Name,
    params: Tool.ParametersEncoded<Tools[Name]>,
  ) =>
    toolkit.handle(name, params, callId).pipe(
      Effect.flatMap(Stream.runLast),
      Effect.flatMap(Effect.fromOption),
      // The toolkit has every tool named here, and each handler ends with one result.
      Effect.orDie,
      Effect.flatMap((result) => {
        const unavailable = unavailableIn([result]);
        return unavailable
          ? Effect.fail(unavailable)
          : Effect.succeed([
              { role: "assistant", content: [{ type: "tool-call", id: callId, name, params }] },
              {
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    id: callId,
                    name,
                    isFailure: result.isFailure,
                    result: result.encodedResult,
                  },
                ],
              },
            ] satisfies ReadonlyArray<Prompt.MessageEncoded>);
      }),
    );
  switch (context.kind) {
    case "category":
      return yield* read("ReadSpending", Struct.omit(context, ["kind"]));
    case "counterparty":
      return yield* read("ReadCounterparty", { counterpartyId: context.counterpartyId });
    case "transaction":
      return yield* read("ReadTransaction", { postingId: context.postingId });
    // A spending stream opens Spending, and any other stream the counted ledger.
    case "stream": {
      const { measure, ...scope } = context.scope;
      return measure === "spending"
        ? yield* read("ReadSpending", {
            period: context.period,
            comparison: context.comparison,
            ...scope,
          })
        : yield* read("ListTransactions", {
            list: { kind: "counted", scope: context.scope, period: context.period, filter: {} },
          });
    }
    // A briefing is written from its month's flow against the month before.
    case "briefing":
      return yield* read("ReadFlow", {
        period: { kind: "months", from: context.month, to: context.month },
        comparison: { kind: "previous" },
      });
  }
});
