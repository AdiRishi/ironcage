import { PreviewCorrection, ApplyCorrection, UndoCorrection } from "@repo/contracts/finance";
import { EventForPosting, EventInput, ReinterpretPostings } from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";

export const reinterpretPostings = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(ReinterpretPostings))
  .handler(({ data }) => callApiRpc((client) => client.reinterpretPostings(data)));
export const getEvent = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(EventInput))
  .handler(({ data }) => callApiRpc((client) => client.getEvent(data)));
export const getEventForPosting = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(EventForPosting))
  .handler(({ data }) => callApiRpc((client) => client.getEventForPosting(data)));
export const getReferenceData = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.getReferenceData()),
);

export const previewCorrection = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(PreviewCorrection))
  .handler(({ data }) => callApiRpc((client) => client.previewCorrection(data)));

export const applyCorrection = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(ApplyCorrection))
  .handler(({ data }) => callApiRpc((client) => client.applyCorrection(data)));

export const undoCorrection = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(UndoCorrection))
  .handler(({ data }) => callApiRpc((client) => client.undoCorrection(data)));

export const getCorrectionHistory = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(EventInput))
  .handler(({ data }) => callApiRpc((client) => client.getCorrectionHistory(data)));
