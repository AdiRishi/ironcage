import {
  AssignEventCounterparty,
  CounterpartyInput,
  ListCounterparties,
  MergeCounterparties,
  MoveAlias,
  SaveCounterparty,
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
