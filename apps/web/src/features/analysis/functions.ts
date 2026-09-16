import {
  OverviewInput,
  AnalysisQuery,
  ContributorsInput,
  AnalysisRowsInput,
} from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";
export const overview = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(OverviewInput))
  .handler(({ data }) => callApiRpc((client) => client.overview(data)));

export const compare = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(AnalysisQuery))
  .handler(({ data }) => callApiRpc((client) => client.compare(data)));
export const contributors = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(ContributorsInput))
  .handler(({ data }) => callApiRpc((client) => client.contributors(data)));

export const rows = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(AnalysisRowsInput))
  .handler(({ data }) => callApiRpc((client) => client.rows(data)));
