import { ImportInput } from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";

export const listImports = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.listImports()),
);
export const getImport = createServerFn({ method: "GET" })
  .inputValidator(Schema.toStandardSchemaV1(ImportInput))
  .handler(({ data }) => callApiRpc((client) => client.getImport(data)));
