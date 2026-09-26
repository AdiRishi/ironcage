import {
  ApplyCounterpartyChange,
  CounterpartyInput,
  ListCounterparties,
  ListCounterpartyHistory,
  PreviewCounterpartyChange,
  PreviewCounterpartyUndo,
  SearchDescriptors,
  UndoCounterpartyChange,
} from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";

export const listCounterparties = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(ListCounterparties))
  .handler(({ data }) => callApiRpc((client) => client.listCounterparties(data)));
export const getCounterparty = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(CounterpartyInput))
  .handler(({ data }) => callApiRpc((client) => client.getCounterparty(data)));
export const searchDescriptors = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(SearchDescriptors))
  .handler(({ data }) => callApiRpc((client) => client.searchDescriptors(data)));
export const previewCounterpartyChange = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(PreviewCounterpartyChange))
  .handler(({ data }) => callApiRpc((client) => client.previewCounterpartyChange(data)));
export const applyCounterpartyChange = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(ApplyCounterpartyChange))
  .handler(({ data }) => callApiRpc((client) => client.applyCounterpartyChange(data)));
export const listCounterpartyHistory = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(ListCounterpartyHistory))
  .handler(({ data }) => callApiRpc((client) => client.listCounterpartyHistory(data)));
export const previewCounterpartyUndo = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(PreviewCounterpartyUndo))
  .handler(({ data }) => callApiRpc((client) => client.previewCounterpartyUndo(data)));
export const undoCounterpartyChange = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(UndoCounterpartyChange))
  .handler(({ data }) => callApiRpc((client) => client.undoCounterpartyChange(data)));
