import {
  ListQuestions,
  type QuestionCursor,
  type SummarizeQuestions,
} from "@repo/contracts/finance";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { Effect, Schema } from "effect";

import { listQuestions, summarizeQuestions } from "./functions";

// The questions with the most money first, one page after another.
export const questionsQuery = (input: Omit<typeof ListQuestions.Type, "cursor">) =>
  infiniteQueryOptions({
    queryKey: ["listQuestions", input, "pages"],
    initialPageParam: null,
    queryFn: async ({ pageParam }: { pageParam: typeof QuestionCursor.Type | null }) =>
      listQuestions({
        data: await Effect.runPromise(
          Schema.encodeEffect(ListQuestions)({ ...input, cursor: pageParam }),
        ),
      }),
    getNextPageParam: (page) => page.nextCursor,
  });
export const questionSummaryQuery = (input: typeof SummarizeQuestions.Type) =>
  queryOptions({
    queryKey: ["summarizeQuestions", input],
    queryFn: () => summarizeQuestions({ data: input }),
  });
