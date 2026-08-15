import {
  FeedClientFrame,
  FeedEventView,
  FeedFilter,
  FeedServerFrame,
  type FeedEventEncoded,
  type FeedEventView as FeedEvent,
  type FeedFilter as FeedSubscription,
  type FeedServerFrame as ServerFrame,
} from "@ironcage/contracts/schema";
import { FeedCursor } from "@ironcage/domain";
import type { FeedActorBinding } from "@ironcage/infra/worker-bindings";
import { DurableObject } from "cloudflare:workers";
import { DateTime, Effect, Schema } from "effect";

import { Postgres } from "../../persistence/postgres";
import { replayFeed } from "./events";

const replayLimit = 500;
const leaseMilliseconds = 15 * 60 * 1_000;

const Attachment = Schema.Struct({
  filter: FeedFilter,
  cursor: Schema.NullOr(FeedCursor),
  state: Schema.Literals(["idle", "replaying", "live"]),
  expiresAt: Schema.Int,
});
type Attachment = typeof Attachment.Type;

interface Session {
  attachment: Attachment;
  buffer: FeedEvent[];
}

const decodeClientFrame = Schema.decodeUnknownSync(FeedClientFrame);
const decodeEvent = Schema.decodeUnknownSync(FeedEventView);
const encodeServerFrame = Schema.encodeSync(FeedServerFrame);

const send = (socket: WebSocket, frame: ServerFrame) =>
  socket.send(JSON.stringify(encodeServerFrame(frame)));

const accepts = (filter: FeedSubscription, event: FeedEvent) =>
  (filter.categories.length === 0 || filter.categories.includes(event.category)) &&
  (filter.severities.length === 0 || filter.severities.includes(event.severity));

export class FeedActor extends DurableObject<Env> implements FeedActorBinding {
  readonly #sessions = new Map<WebSocket, Session>();

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    const heartbeat = JSON.stringify(Schema.encodeSync(FeedClientFrame)({ _tag: "Heartbeat" }));
    const heartbeatAck = JSON.stringify(encodeServerFrame({ _tag: "HeartbeatAck" }));
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(heartbeat, heartbeatAck));

    for (const socket of this.ctx.getWebSockets()) {
      try {
        const decoded = Schema.decodeUnknownSync(Attachment)(socket.deserializeAttachment());
        if (decoded.state === "replaying") {
          socket.close(1012, "reconnect to recover feed cursor");
        } else {
          this.#sessions.set(socket, { attachment: decoded, buffer: [] });
        }
      } catch {
        socket.close(1012, "invalid feed session");
      }
    }
  }

  async ping() {
    return { worker: "ironcage-core", object: this.constructor.name };
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }

    const now = await Effect.runPromise(DateTime.now);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: Attachment = {
      filter: { categories: [], severities: [] },
      cursor: null,
      state: "idle",
      expiresAt: DateTime.toEpochMillis(now) + leaseMilliseconds,
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server);
    this.#sessions.set(server, { attachment, buffer: [] });
    await this.#scheduleExpiry();
    return new Response(null, { status: 101, webSocket: client });
  }

  async publish(encoded: FeedEventEncoded): Promise<void> {
    const event = decodeEvent(encoded);
    for (const [socket, session] of this.#sessions) {
      if (!accepts(session.attachment.filter, event)) continue;
      if (session.attachment.state === "replaying") {
        session.buffer.push(event);
      } else if (session.attachment.state === "live") {
        send(socket, { _tag: "Event", event });
        this.#attach(socket, session, { cursor: event.cursor });
      }
    }
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const text = message instanceof ArrayBuffer ? new TextDecoder().decode(message) : message;
      const frame = decodeClientFrame(JSON.parse(text));
      if (frame._tag === "Subscribe") {
        await this.#subscribe(socket, frame.since, frame.filter);
      } else if (frame._tag === "Ack") {
        const session = this.#session(socket);
        this.#attach(socket, session, { cursor: frame.through });
      } else {
        send(socket, { _tag: "HeartbeatAck" });
      }
    } catch {
      socket.close(1003, "invalid feed frame");
      this.#sessions.delete(socket);
    }
  }

  override webSocketClose(socket: WebSocket): void {
    this.#sessions.delete(socket);
  }

  override webSocketError(socket: WebSocket): void {
    this.#sessions.delete(socket);
  }

  override async alarm(): Promise<void> {
    const at = await Effect.runPromise(DateTime.now);
    const now = DateTime.toEpochMillis(at);
    for (const [socket, session] of this.#sessions) {
      if (session.attachment.expiresAt > now) continue;
      send(socket, { _tag: "Closing", reason: "lease-expired", at });
      socket.close(1000, "feed lease expired");
      this.#sessions.delete(socket);
    }
    await this.#scheduleExpiry();
  }

  async #subscribe(
    socket: WebSocket,
    since: typeof FeedCursor.Type | null,
    filter: FeedSubscription,
  ): Promise<void> {
    const session = this.#session(socket);
    session.buffer = [];
    this.#attach(socket, session, { state: "replaying", cursor: since, filter });

    const replay = await Effect.runPromise(
      Effect.gen(function* () {
        const postgres = yield* Postgres;
        return yield* postgres.readTransaction((sql) =>
          replayFeed(sql, {
            since,
            categories: filter.categories,
            severities: filter.severities,
            limit: replayLimit + 1,
          }),
        );
      }).pipe(Effect.provide(Postgres.layerForRequest(this.env.DB.connectionString))),
    );

    if (replay.events.length > replayLimit) {
      session.buffer = [];
      this.#attach(socket, session, { state: "live", cursor: replay.cursor });
      send(socket, { _tag: "Lagged", from: since, through: replay.cursor });
      return;
    }

    const events = new Map(replay.events.map((event) => [event.id, event]));
    for (const event of session.buffer) events.set(event.id, event);
    const ordered = [...events.values()].sort((left, right) => {
      const leftCursor = BigInt(left.cursor);
      const rightCursor = BigInt(right.cursor);
      return leftCursor < rightCursor ? -1 : leftCursor > rightCursor ? 1 : 0;
    });
    for (const event of ordered) send(socket, { _tag: "Event", event });

    const cursor = ordered.at(-1)?.cursor ?? replay.cursor;
    session.buffer = [];
    this.#attach(socket, session, { state: "live", cursor });
    const serverTime = await Effect.runPromise(DateTime.now);
    send(socket, { _tag: "Ready", cursor, replayed: replay.events.length, serverTime });
  }

  #session(socket: WebSocket): Session {
    const session = this.#sessions.get(socket);
    if (session === undefined) throw new Error("unknown feed socket");
    return session;
  }

  #attach(socket: WebSocket, session: Session, update: Partial<Attachment>): void {
    session.attachment = { ...session.attachment, ...update };
    socket.serializeAttachment(session.attachment);
  }

  async #scheduleExpiry(): Promise<void> {
    const next = [...this.#sessions.values()]
      .map((session) => session.attachment.expiresAt)
      .sort((left, right) => left - right)[0];
    if (next === undefined) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(next);
    }
  }
}
