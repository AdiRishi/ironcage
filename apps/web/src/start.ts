import { createSerializationAdapter } from "@tanstack/react-router";
import { createCsrfMiddleware, createStart } from "@tanstack/react-start";

import { appRequestErrorSerialization } from "@/lib/app-error";
import { serverFnFetch } from "@/lib/server-fn-fetch";

const csrfMiddleware = createCsrfMiddleware({
  filter: (context) => context.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  serverFns: { fetch: serverFnFetch },
  requestMiddleware: [csrfMiddleware],
  serializationAdapters: [createSerializationAdapter(appRequestErrorSerialization)],
}));
