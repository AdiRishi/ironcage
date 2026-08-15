import {
  FeedClientFrame,
  FeedServerFrame,
  type FeedEventView,
  type FeedServerFrame as ServerFrame,
} from "@ironcage/contracts/schema";
import { FeedCursor } from "@ironcage/domain";
import { Schema } from "effect";

export type FeedConnection = "connecting" | "live" | "reconnecting" | "offline";

const cursorKey = "ironcage.feed.cursor";
const encodeClientFrame = Schema.encodeSync(FeedClientFrame);
const decodeServerFrame = Schema.decodeUnknownSync(FeedServerFrame);
const decodeCursor = Schema.decodeUnknownSync(FeedCursor);

export interface FeedCursorStore {
  readonly read: () => typeof FeedCursor.Type | null;
  readonly set: (cursor: typeof FeedCursor.Type) => void;
  readonly advance: (cursor: typeof FeedCursor.Type) => boolean;
}

export const createFeedCursorStore = (
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
) =>
  ({
    read: () => {
      const stored = storage.getItem(cursorKey);
      if (stored === null) return null;
      try {
        return decodeCursor(stored);
      } catch {
        storage.removeItem(cursorKey);
        return null;
      }
    },
    set: (cursor) => storage.setItem(cursorKey, cursor),
    advance: (cursor) => {
      const current = storage.getItem(cursorKey);
      if (current !== null && BigInt(cursor) <= BigInt(current)) return false;
      storage.setItem(cursorKey, cursor);
      return true;
    },
  }) satisfies FeedCursorStore;

export interface FeedClientCallbacks {
  readonly onConnection: (connection: FeedConnection) => void;
  readonly onEvent: (event: FeedEventView) => void;
  readonly onLagged: () => void;
}

export const connectFeed = (callbacks: FeedClientCallbacks): (() => void) => {
  const cursors = createFeedCursorStore(sessionStorage);
  let stopped = false;
  let socket: WebSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let backoff = 1_000;
  let lastHeartbeat = Date.now();

  const send = (frame: typeof FeedClientFrame.Type) => {
    socket?.send(JSON.stringify(encodeClientFrame(frame)));
  };

  const applyFrame = (frame: ServerFrame) => {
    switch (frame._tag) {
      case "Event":
        if (cursors.advance(frame.event.cursor)) {
          callbacks.onEvent(frame.event);
          send({ _tag: "Ack", through: frame.event.cursor });
        }
        break;
      case "Ready":
        if (frame.cursor !== null) cursors.set(frame.cursor);
        lastHeartbeat = Date.now();
        backoff = 1_000;
        callbacks.onConnection("live");
        break;
      case "HeartbeatAck":
        lastHeartbeat = Date.now();
        break;
      case "Lagged":
        if (frame.through !== null) cursors.set(frame.through);
        callbacks.onLagged();
        callbacks.onConnection("live");
        break;
      case "Closing":
        if (frame.reason === "token-expired") window.location.reload();
        break;
    }
  };

  const connect = () => {
    if (stopped) return;
    callbacks.onConnection(backoff === 1_000 ? "connecting" : "reconnecting");
    const url = new URL("/api/feed.ws", window.location.href);
    url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(url);
    socket.addEventListener("open", () => {
      lastHeartbeat = Date.now();
      send({
        _tag: "Subscribe",
        since: cursors.read(),
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
      callbacks.onConnection("offline");
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
};
