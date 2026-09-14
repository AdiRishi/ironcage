import { ListReviewItems, ResolveReview } from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";

export const listReviewItems = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(ListReviewItems))
  .handler(({ data }) => callApiRpc((client) => client.listReviewItems(data)));
export const resolveReview = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(ResolveReview))
  .handler(({ data }) => callApiRpc((client) => client.resolveReview(data)));
