import { intoTaxonomy } from "@ironcage/contracts/client";
import { SystemPing } from "@ironcage/contracts/schema";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import { callCore } from "./core.server";

export const getSystemPing = createServerFn().handler(() =>
  // A server function's result is serialized on its way to the browser, and
  // the encoded form is what the schema says that looks like.
  callCore((client) => intoTaxonomy(client.ping()).pipe(Effect.map(Schema.encodeSync(SystemPing)))),
);
