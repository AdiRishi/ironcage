import type { WebsiteEnv } from "@repo/infra/worker-bindings";
import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";

import { authenticate, validMutationOrigin } from "./server/access";

const handler = createStartHandler(defaultStreamHandler);

export default {
  async fetch(request, env) {
    if (!(await authenticate(request, env)))
      return new Response("Authentication required", { status: 401 });
    if (!validMutationOrigin(request)) return new Response("Forbidden", { status: 403 });
    return handler(request);
  },
} satisfies ExportedHandler<WebsiteEnv>;
