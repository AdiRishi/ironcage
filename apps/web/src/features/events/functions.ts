import { EventForPosting, EventInput, InterpretPostings } from "@repo/contracts/finance";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";

export const interpretPostings = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(InterpretPostings))
  .handler(({ data }) => callApiRpc((client) => client.interpretPostings(data)));
export const getEvent = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(EventInput))
  .handler(({ data }) => callApiRpc((client) => client.getEvent(data)));
export const getEventForPosting = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(EventForPosting))
  .handler(({ data }) => callApiRpc((client) => client.getEventForPosting(data)));
export const getInterpretationSummary = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.getInterpretationSummary()),
);
export const getReferenceData = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.getReferenceData()),
);
