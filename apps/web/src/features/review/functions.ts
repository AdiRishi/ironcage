import { ResolveReview } from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";

export const listReviewItems = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.listReviewItems()),
);
export const resolveReview = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(ResolveReview))
  .handler(({ data }) => callApiRpc((client) => client.resolveReview(data)));
