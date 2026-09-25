import { ListQuestions, SummarizeQuestions } from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";

export const listQuestions = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(ListQuestions))
  .handler(({ data }) => callApiRpc((client) => client.listQuestions(data)));
export const summarizeQuestions = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(SummarizeQuestions))
  .handler(({ data }) => callApiRpc((client) => client.summarizeQuestions(data)));
