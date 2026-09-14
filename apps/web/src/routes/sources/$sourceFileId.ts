import { createFileRoute } from "@tanstack/react-router";

import { fetchApi } from "@/server/api-client.server";
export const Route = createFileRoute("/sources/$sourceFileId")({
  server: {
    handlers: {
      GET: ({ params }) => fetchApi(`/sources/${encodeURIComponent(params.sourceFileId)}`),
    },
  },
});
