import { ListCountedLedger, ListPostings, PostingInput } from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";

export const listLedger = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(ListPostings))
  .handler(({ data }) => callApiRpc((client) => client.listLedger(data)));
export const listCountedLedger = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(ListCountedLedger))
  .handler(({ data }) => callApiRpc((client) => client.listCountedLedger(data)));
export const getPosting = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(PostingInput))
  .handler(({ data }) => callApiRpc((client) => client.getPosting(data)));
