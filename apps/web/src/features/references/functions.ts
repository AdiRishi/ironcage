import { SaveReference, DeleteReference } from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";
export const saveReference = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(SaveReference))
  .handler(({ data }) => callApiRpc((client) => client.saveReference(data)));
export const deleteReference = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(DeleteReference))
  .handler(({ data }) => callApiRpc((client) => client.deleteReference(data)));
