import {
  ApplyRelationship,
  DismissInterpretationReview,
  EventInput,
  ListInterpretationReviews,
  ListRelationshipCandidates,
  PreviewRelationship,
  ProposeRelationships,
} from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";
export const getEventRelationships = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(EventInput))
  .handler(({ data }) => callApiRpc((client) => client.getEventRelationships(data)));
export const listRelationshipCandidates = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(ListRelationshipCandidates))
  .handler(({ data }) => callApiRpc((client) => client.listRelationshipCandidates(data)));
export const previewRelationship = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(PreviewRelationship))
  .handler(({ data }) => callApiRpc((client) => client.previewRelationship(data)));
export const applyRelationship = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(ApplyRelationship))
  .handler(({ data }) => callApiRpc((client) => client.applyRelationship(data)));
export const listInterpretationReviews = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(ListInterpretationReviews))
  .handler(({ data }) => callApiRpc((client) => client.listInterpretationReviews(data)));
export const proposeRelationships = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(ProposeRelationships))
  .handler(({ data }) => callApiRpc((client) => client.proposeRelationships(data)));
export const dismissInterpretationReview = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(DismissInterpretationReview))
  .handler(({ data }) => callApiRpc((client) => client.dismissInterpretationReview(data)));
