import { ImportInput, ListImports, RetryImport } from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";

export const listImports = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(ListImports))
  .handler(({ data }) => callApiRpc((client) => client.listImports(data)));
export const getImport = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(ImportInput))
  .handler(({ data }) => callApiRpc((client) => client.getImport(data)));

export const retryImport = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(RetryImport))
  .handler(({ data }) => callApiRpc((client) => client.retryImport(data)));
