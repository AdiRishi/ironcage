import { HaltAllInput, SystemStatus } from "@ironcage/contracts/schema";
import { createServerFn } from "@tanstack/react-start";

import { decodePayload, encodedRead, intoOutcome } from "@/server/boundary";
import { callCore } from "@/server/core";

export const getSystemStatus = createServerFn().handler(() =>
  callCore((client) => encodedRead(SystemStatus)(client.getSystemStatus())),
);

export const haltAll = createServerFn({ method: "POST" })
  .validator(decodePayload(HaltAllInput))
  .handler(({ data }) => callCore((client) => intoOutcome(SystemStatus)(client.haltAll(data))));
