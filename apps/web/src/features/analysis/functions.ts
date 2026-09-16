import { OverviewInput } from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";
export const overview = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(OverviewInput))
  .handler(({ data }) => callApiRpc((client) => client.overview(data)));
