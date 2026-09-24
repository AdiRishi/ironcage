import {
  RequestEnrichment,
  ResolveCategoryProposal,
  UpdateEnrichmentSettings,
} from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";

export const getEnrichmentSettings = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.getEnrichmentSettings()),
);
export const listEnrichmentRuns = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.listEnrichmentRuns()),
);
export const updateEnrichmentSettings = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(UpdateEnrichmentSettings))
  .handler(({ data }) => callApiRpc((client) => client.updateEnrichmentSettings(data)));
export const requestEnrichment = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(RequestEnrichment))
  .handler(({ data }) => callApiRpc((client) => client.requestEnrichment(data)));
export const listCategoryProposals = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.listCategoryProposals()),
);
export const resolveCategoryProposal = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(ResolveCategoryProposal))
  .handler(({ data }) => callApiRpc((client) => client.resolveCategoryProposal(data)));
