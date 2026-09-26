import { UnbuiltCapability } from "@repo/contracts/analyst";
import { Array as Arr, Effect, Schema } from "effect";
import { Tool } from "effect/unstable/ai";

import { checkAgainst } from "../answers/check.ts";
import { TurnEvidence } from "../evidence/service.ts";

export const Answer = Tool.make("Answer", {
  description:
    "Finish the turn with your answer. Cite every amount, count, change, percentage, and " +
    "average as the figure token a tool returned, such as [[f3]], and a transaction or " +
    "counterparty as its record token, such as [[r2]]. Name the period beside every " +
    "figure. Write no other numbers, in digits or in words, except dates, and no links. " +
    'Separate paragraphs with a blank line, and start each line of a list with "- ". Put ' +
    "in `missing` what your records cannot answer, naming the capability when it is one " +
    "not built yet. An answer with problems comes back with them; fix every one and " +
    "answer again.",
  parameters: Schema.Struct({
    text: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(4000)),
    missing: Schema.Array(
      Schema.Struct({
        text: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
        capability: Schema.NullOr(UnbuiltCapability),
      }),
    ),
  }),
  success: Schema.Struct({ accepted: Schema.Literal(true) }),
  failure: Schema.Struct({ problems: Schema.Array(Schema.String) }),
  failureMode: "return",
  dependencies: [TurnEvidence],
});

// Checks the answer against what the turn's tools returned, and accepts it for the turn.
// An accepted answer states the capabilities it needs that are not built yet as limits.
export const answer = Effect.fn("Answer")(function* ({
  text,
  missing,
}: Tool.Parameters<typeof Answer>) {
  const evidence = yield* TurnEvidence;
  const check = checkAgainst(yield* evidence.snapshot);
  const problems = Arr.dedupe([text, ...missing.map((item) => item.text)].flatMap(check));
  if (problems.length > 0) return yield* Effect.fail({ problems });
  for (const capability of Arr.dedupe(missing.flatMap((item) => item.capability ?? [])))
    yield* evidence.limit({ kind: "notBuilt", capability });
  yield* evidence.accept({ text, missing: missing.map((item) => item.text) });
  return { accepted: true } as const;
});
