import { AskContext } from "@repo/contracts/analyst";
import { Schema } from "effect";

// A new question's address. `?about=` holds the selection "Ask about this" was chosen on,
// which the question is asked about.
export const NewQuestionSearch = Schema.Struct({ about: Schema.optional(AskContext) });
