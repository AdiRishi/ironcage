import { createFileRoute } from "@tanstack/react-router";

import { fetchApi } from "@/server/api-client.server";
export const Route = createFileRoute("/uploads")({
  server: {
    handlers: {
      POST: ({ request }) =>
        fetchApi("/uploads", { method: "POST", headers: request.headers, body: request.body }),
    },
  },
});
