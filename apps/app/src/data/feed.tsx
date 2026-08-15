import {
  FeedClientFrame,
  FeedServerFrame,
  type FeedEventView,
  type FeedServerFrame as ServerFrame,
} from "@ironcage/contracts/schema";
import { FeedCursor } from "@ironcage/domain";
import { useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";
import { createContext, useContext, useEffect, useState } from "react";

import { invalidationsFor } from "@/data/invalidation";

type FeedConnection = "connecting" | "live" | "reconnecting" | "offline";

const FeedConnectionContext = createContext<FeedConnection>("connecting");
const cursorKey = "ironcage.feed.cursor";
const encodeClientFrame = Schema.encodeSync(FeedClientFrame);
const decodeServerFrame = Schema.decodeUnknownSync(FeedServerFrame);
const decodeCursor = Schema.decodeUnknownSync(FeedCursor);

const readCursor = () => {
  const stored = sessionStorage.getItem(cursorKey);
  if (stored === null) return null;
  try {
    return decodeCursor(stored);
  } catch {
    sessionStorage.removeItem(cursorKey);
    return null;
  }
};

export function FeedProvider({ children }: { readonly children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<FeedConnection>("connecting");

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let backoff = 1_000;
    let lastHeartbeat = Date.now();

    const send = (frame: typeof FeedClientFrame.Type) => {
      socket?.send(JSON.stringify(encodeClientFrame(frame)));
    };

    const applyEvent = (event: FeedEventView) => {
      const current = sessionStorage.getItem(cursorKey);
      if (current !== null && BigInt(event.cursor) <= BigInt(current)) return;
      sessionStorage.setItem(cursorKey, event.cursor);
      for (const queryKey of invalidationsFor(event)) {
        queryClient.invalidateQueries({ queryKey }).catch(() => undefined);
      }
      send({ _tag: "Ack", through: event.cursor });
    };

    const applyFrame = (frame: ServerFrame) => {
      if (frame._tag === "Event") {
        applyEvent(frame.event);
      } else if (frame._tag === "Ready") {
        if (frame.cursor !== null) sessionStorage.setItem(cursorKey, frame.cursor);
        lastHeartbeat = Date.now();
        backoff = 1_000;
        setConnection("live");
      } else if (frame._tag === "HeartbeatAck") {
        lastHeartbeat = Date.now();
      } else if (frame._tag === "Lagged") {
        if (frame.through !== null) sessionStorage.setItem(cursorKey, frame.through);
        queryClient.invalidateQueries({ type: "active" }).catch(() => undefined);
        setConnection("live");
      } else if (frame.reason === "token-expired") {
        window.location.reload();
      }
    };

    const connect = () => {
      if (stopped) return;
      setConnection(backoff === 1_000 ? "connecting" : "reconnecting");
      const url = new URL("/api/feed.ws", window.location.href);
      url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url);
      socket.addEventListener("open", () => {
        lastHeartbeat = Date.now();
        send({
          _tag: "Subscribe",
          since: readCursor(),
          filter: { categories: [], severities: [] },
        });
        heartbeatTimer = setInterval(() => {
          if (Date.now() - lastHeartbeat > 45_000) {
            socket?.close();
            return;
          }
          send({ _tag: "Heartbeat" });
        }, 30_000);
      });
      socket.addEventListener("message", (message) => {
        try {
          applyFrame(decodeServerFrame(JSON.parse(String(message.data))));
        } catch {
          socket?.close(1003, "invalid feed frame");
        }
      });
      socket.addEventListener("close", (event) => {
        if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
        if (stopped) return;
        if (event.code === 4401) {
          window.location.reload();
          return;
        }
        setConnection("offline");
        const delay = backoff * (0.8 + Math.random() * 0.4);
        backoff = Math.min(backoff * 2, 30_000);
        reconnectTimer = setTimeout(connect, delay);
      });
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
      socket?.close();
    };
  }, [queryClient]);

  return (
    <FeedConnectionContext.Provider value={connection}>{children}</FeedConnectionContext.Provider>
  );
}

export const useFeedConnection = () => useContext(FeedConnectionContext);
