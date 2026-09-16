import {
  AcceptSuggestions,
  EventInput,
  SuggestCategories,
  UpdateClassificationSettings,
} from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";
export const getClassificationSettings = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.getClassificationSettings()),
);
export const listClassificationRuns = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.listClassificationRuns()),
);
export const listSuggestions = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.listSuggestions()),
);
export const updateClassificationSettings = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(UpdateClassificationSettings))
  .handler(({ data }) => callApiRpc((client) => client.updateClassificationSettings(data)));
export const suggestCategories = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(SuggestCategories))
  .handler(({ data }) => callApiRpc((client) => client.suggestCategories(data)));
export const acceptSuggestions = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(AcceptSuggestions))
  .handler(({ data }) => callApiRpc((client) => client.acceptSuggestions(data)));

export const getCategorySuggestion = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(EventInput))
  .handler(({ data }) => callApiRpc((client) => client.getCategorySuggestion(data)));
