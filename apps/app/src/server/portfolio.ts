import {
  ExternalAccount,
  RecordExternalBalanceInput,
  WholeWealth,
} from "@ironcage/contracts/schema";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { decodePayload, encodedRead, intoOutcome } from "@/server/boundary";
import { callCore } from "@/server/core.server";

export const getWholeWealth = createServerFn().handler(() =>
  callCore((client) => encodedRead(WholeWealth)(client.getWholeWealth())),
);

export const listExternalAccounts = createServerFn().handler(() =>
  callCore((client) => encodedRead(Schema.Array(ExternalAccount))(client.listExternalAccounts())),
);

export const recordExternalBalance = createServerFn({ method: "POST" })
  .validator(decodePayload(RecordExternalBalanceInput))
  .handler(({ data }) =>
    callCore((client) => intoOutcome(ExternalAccount)(client.recordExternalBalance(data))),
  );
