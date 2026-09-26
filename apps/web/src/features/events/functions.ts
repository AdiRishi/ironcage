import {
  ApplyCorrection,
  AssignEventCounterparty,
  EventForPosting,
  EventInput,
  PreviewCorrection,
  PreviewEventCounterparty,
  PreviewUndoCorrection,
  ReinterpretPostings,
  UndoCorrection,
} from "@repo/contracts/finance";
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

export const previewEventCounterparty = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(PreviewEventCounterparty))
  .handler(({ data }) => callApiRpc((client) => client.previewEventCounterparty(data)));

export const assignEventCounterparty = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(AssignEventCounterparty))
  .handler(({ data }) => callApiRpc((client) => client.assignEventCounterparty(data)));

export const previewUndoCorrection = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(PreviewUndoCorrection))
  .handler(({ data }) => callApiRpc((client) => client.previewUndoCorrection(data)));

export const undoCorrection = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(UndoCorrection))
  .handler(({ data }) => callApiRpc((client) => client.undoCorrection(data)));

export const getEventHistory = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(EventInput))
  .handler(({ data }) => callApiRpc((client) => client.getEventHistory(data)));
