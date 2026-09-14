import { RemoveSourceBytes } from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";

export const listSourceFiles = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.listSourceFiles()),
);
export const removeSourceBytes = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(RemoveSourceBytes))
  .handler(({ data }) => callApiRpc((client) => client.removeSourceBytes(data)));
