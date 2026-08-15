import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { env } from "cloudflare:workers";

export default createServerEntry({
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/feed.ws") return handler.fetch(request);

    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    if (request.headers.get("origin") !== url.origin) {
      return new Response("Forbidden", { status: 403 });
    }

    return env.CORE.fetch(new Request("https://core.internal/feed", request));
  },
});
