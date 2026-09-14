import { createServerFn } from "@tanstack/react-start";

import { callApiRpc } from "@/server/api-client.server";

export const listAccounts = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.listAccounts()),
);
