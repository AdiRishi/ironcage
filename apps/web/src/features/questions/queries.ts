import { queryOptions } from "@tanstack/react-query";

import { listQuestions } from "./functions";

export const questionsQuery = (currency: string) =>
  queryOptions({
    queryKey: ["questions", currency],
    queryFn: () => listQuestions({ data: { currency } }),
  });
