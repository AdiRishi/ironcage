import { DeleteRule, PreviewRule, RuleInput, SaveRule } from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";
export const listRules = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.listRules()),
);
export const getRuleExceptions = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(RuleInput))
  .handler(({ data }) => callApiRpc((client) => client.getRuleExceptions(data)));
export const previewRule = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(PreviewRule))
  .handler(({ data }) => callApiRpc((client) => client.previewRule(data)));
export const saveRule = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(SaveRule))
  .handler(({ data }) => callApiRpc((client) => client.saveRule(data)));
export const deleteRule = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(DeleteRule))
  .handler(({ data }) => callApiRpc((client) => client.deleteRule(data)));
