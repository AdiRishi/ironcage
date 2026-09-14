import { createFileRoute } from "@tanstack/react-router";

import { fetchApi } from "@/server/api-client.server";
export const Route = createFileRoute("/exports/$exportId")({
  server: {
    handlers: { GET: ({ params }) => fetchApi(`/exports/${encodeURIComponent(params.exportId)}`) },
  },
});
