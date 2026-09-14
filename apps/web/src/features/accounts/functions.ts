import { CreateAccount, UpdateAccount } from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";

export const listAccounts = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.listAccounts()),
);

export const createAccount = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(CreateAccount))
  .handler(({ data }) => callApiRpc((client) => client.createAccount(data)));
export const updateAccount = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(UpdateAccount))
  .handler(({ data }) => callApiRpc((client) => client.updateAccount(data)));
