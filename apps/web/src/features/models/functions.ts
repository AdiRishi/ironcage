import { UpdateModelSettings } from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";

export const getModelSettings = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.getModelSettings()),
);
export const updateModelSettings = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(UpdateModelSettings))
  .handler(({ data }) => callApiRpc((client) => client.updateModelSettings(data)));
export const getModelUsage = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.getModelUsage()),
);
