import { RequestExport } from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";

export const listExports = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.listExports()),
);
export const requestExport = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(RequestExport))
  .handler(({ data }) => callApiRpc((client) => client.requestExport(data)));
