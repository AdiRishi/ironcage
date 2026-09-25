import { UpdateSettings } from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";

export const getSettings = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.getSettings()),
);
export const updateSettings = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(UpdateSettings))
  .handler(({ data }) => callApiRpc((client) => client.updateSettings(data)));

export const getRetention = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.getRetention()),
);
