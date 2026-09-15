import { SaveAccountPeriod, DeleteAccountPeriod } from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";
export const listAccountPeriods = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.listAccountPeriods()),
);
export const saveAccountPeriod = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(SaveAccountPeriod))
  .handler(({ data }) => callApiRpc((client) => client.saveAccountPeriod(data)));
export const deleteAccountPeriod = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(DeleteAccountPeriod))
  .handler(({ data }) => callApiRpc((client) => client.deleteAccountPeriod(data)));
