import { FlowInput, MonthlyFlowInput } from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";

export const getPeriodFlow = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(FlowInput))
  .handler(({ data }) => callApiRpc((client) => client.getPeriodFlow(data)));
export const getMonthlyFlow = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(MonthlyFlowInput))
  .handler(({ data }) => callApiRpc((client) => client.getMonthlyFlow(data)));
export const getFactsStatus = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.getFactsStatus()),
);
