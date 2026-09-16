import { SaveAnalysis, GetAnalysis, RenameAnalysis, DeleteAnalysis } from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";
export const saveAnalysis = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(SaveAnalysis))
  .handler(({ data }) => callApiRpc((client) => client.saveAnalysis(data)));
export const getAnalysis = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(GetAnalysis))
  .handler(({ data }) => callApiRpc((client) => client.getAnalysis(data)));
export const listAnalyses = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.listAnalyses()),
);
export const renameAnalysis = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(RenameAnalysis))
  .handler(({ data }) => callApiRpc((client) => client.renameAnalysis(data)));
export const deleteAnalysis = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(DeleteAnalysis))
  .handler(({ data }) => callApiRpc((client) => client.deleteAnalysis(data)));
