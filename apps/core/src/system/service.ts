import { SystemStatus, ValidationFailed } from "@ironcage/contracts/schema";
import { FeedEventId, SystemMode, type RequestId, type Sha256 } from "@ironcage/domain";
import { Effect, Schema } from "effect";

import { mintId } from "../ids";
import { insertFeedEvent } from "../money/feed/repository";
import { runIdempotentMutation } from "../persistence/app-requests";
import { persistenceToBoundary } from "../persistence/error";
import { decodeRows, Postgres, type SqlExecutor } from "../persistence/postgres";

const SystemStateRow = Schema.Struct({
  mode: SystemMode,
  reason: Schema.NullOr(Schema.String),
  changedAt: Schema.DateTimeUtcFromDate,
  unacknowledgedCriticals: Schema.Int,
});

const loadSystemStatus = (sql: SqlExecutor) =>
  Effect.gen(function* () {
    const rows = yield* sql.query(
      "read system status",
      `SELECT s.mode, s.reason, s.changed_at AS "changedAt",
              (SELECT count(*)::integer
                 FROM feed_events e
                 LEFT JOIN acknowledgments a ON a.event_id = e.id
                WHERE e.severity = 'critical' AND a.event_id IS NULL) AS "unacknowledgedCriticals"
         FROM system_state s WHERE s.singleton`,
    );
    const status = (yield* decodeRows("decode system status", SystemStateRow, rows))[0];
    return status ?? (yield* Effect.die(new Error("system state singleton is missing")));
  });

export const getSystemStatus = () =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;
    return yield* postgres.readTransaction(loadSystemStatus);
  }).pipe(persistenceToBoundary);

export const haltAll = (input: {
  readonly requestId: RequestId;
  readonly payloadHash: Sha256;
  readonly reason: string;
}) =>
  Effect.gen(function* () {
    const reason = input.reason.trim();
    if (reason.length === 0) {
      return yield* Effect.fail(
        new ValidationFailed({ reason: "InvalidHaltReason", detail: "a halt reason is required" }),
      );
    }

    return yield* runIdempotentMutation(
      {
        requestId: input.requestId,
        operation: "haltAll",
        payloadHash: input.payloadHash,
        response: SystemStatus,
      },
      (sql) =>
        Effect.gen(function* () {
          const changed = yield* sql.query(
            "halt system",
            `UPDATE system_state
                SET mode = 'halted', reason = $1, changed_at = now()
              WHERE singleton AND mode <> 'halted'
              RETURNING mode`,
            [reason],
          );
          if (changed.length > 0) {
            yield* insertFeedEvent(sql, {
              id: yield* mintId(FeedEventId),
              origin: "system",
              category: "system",
              eventType: "system_halted",
              severity: "critical",
              summary: `System halted: ${reason}`,
              payload: { reason, triggeredBy: "operator" },
              links: null,
            });
          }
          return yield* loadSystemStatus(sql);
        }),
    );
  });
