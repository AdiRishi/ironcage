import {
  AssignEventCounterparty,
  CounterpartyInput,
  DeleteReferenceDefault,
  ListCounterparties,
  MergeCounterparties,
  MoveAlias,
  SaveCounterparty,
  SaveReferenceDefault,
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
export const saveCounterparty = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(SaveCounterparty))
  .handler(({ data }) => callApiRpc((client) => client.saveCounterparty(data)));
export const mergeCounterparties = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(MergeCounterparties))
  .handler(({ data }) => callApiRpc((client) => client.mergeCounterparties(data)));
export const moveAlias = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(MoveAlias))
  .handler(({ data }) => callApiRpc((client) => client.moveAlias(data)));
export const assignEventCounterparty = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(AssignEventCounterparty))
  .handler(({ data }) => callApiRpc((client) => client.assignEventCounterparty(data)));
export const saveReferenceDefault = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(SaveReferenceDefault))
  .handler(({ data }) => callApiRpc((client) => client.saveReferenceDefault(data)));
export const deleteReferenceDefault = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(DeleteReferenceDefault))
  .handler(({ data }) => callApiRpc((client) => client.deleteReferenceDefault(data)));
