import { Conflict, NotFound, ValidationFailed } from "@ironcage/contracts/schema";
import { FeedEvent, type FeedEventId, type RequestId } from "@ironcage/domain";
import { Context, DateTime, Effect, Layer } from "effect";

import { infrastructureError, type MoneyBoundaryError, replayRequest } from "../money/boundary";
import { canonicalJson, MoneyCryptography, sha256Text } from "../money/crypto";
import type { FeedQuery } from "./repository";
import { ActivityRepository } from "./repository";

export class ActivityFeed extends Context.Service<
  ActivityFeed,
  {
    readonly list: (
      query: FeedQuery,
    ) => Effect.Effect<
      { readonly events: readonly FeedEvent[]; readonly nextCursor: FeedEventId | null },
      MoneyBoundaryError
    >;
    readonly attention: Effect.Effect<readonly FeedEvent[], MoneyBoundaryError>;
    readonly acknowledge: (input: {
      readonly eventId: FeedEventId;
      readonly requestId: RequestId;
    }) => Effect.Effect<FeedEvent, MoneyBoundaryError>;
  }
>()("ironcage/core/activity/ActivityFeed") {
  static readonly layer = Layer.effect(
    ActivityFeed,
    Effect.gen(function* () {
      const repository = yield* ActivityRepository;
      const cryptography = yield* MoneyCryptography;

      const list = Effect.fn("ActivityFeed.list")(function* (query: FeedQuery) {
        if (
          query.occurredFrom !== null &&
          query.occurredThrough !== null &&
          DateTime.toEpochMillis(query.occurredFrom) > DateTime.toEpochMillis(query.occurredThrough)
        ) {
          return yield* new ValidationFailed({
            reason: "InvalidFeedWindow",
            detail: "the feed start must not follow its end",
          });
        }
        return yield* repository.list(query).pipe(Effect.mapError(infrastructureError));
      });

      const acknowledge = Effect.fn("ActivityFeed.acknowledge")(function* (input: {
        readonly eventId: FeedEventId;
        readonly requestId: RequestId;
      }): Effect.fn.Return<FeedEvent, MoneyBoundaryError> {
        const payloadHash = yield* sha256Text(
          cryptography,
          canonicalJson({ eventId: input.eventId }),
        ).pipe(Effect.mapError(infrastructureError));

        return yield* repository
          .withTransaction((transaction) =>
            Effect.gen(function* () {
              const previousRequest = yield* transaction.request(input.requestId);
              if (previousRequest !== null) {
                if (
                  previousRequest.operation !== "activity.acknowledge" ||
                  previousRequest.payloadHash !== payloadHash
                ) {
                  return yield* new Conflict({
                    reason: "RequestIdCollision",
                    detail: `${input.requestId} was already used with different content`,
                  });
                }
                return yield* replayRequest({
                  requests: [previousRequest],
                  requestId: input.requestId,
                  operation: "activity.acknowledge",
                  payloadHash,
                  schema: FeedEvent,
                }).pipe(
                  Effect.flatMap((event) =>
                    event === null
                      ? Effect.fail(new NotFound({ entity: "feed event", id: input.eventId }))
                      : Effect.succeed(event),
                  ),
                );
              }

              const event = yield* transaction.event(input.eventId);
              if (event === null) {
                return yield* new NotFound({ entity: "feed event", id: input.eventId });
              }
              if (event.severity !== "critical") {
                return yield* new ValidationFailed({
                  reason: "AcknowledgmentNotRequired",
                  detail: "only critical feed events require acknowledgment",
                });
              }
              const acknowledgedAt = event.acknowledgedAt ?? (yield* DateTime.now);
              const response = { ...event, acknowledgedAt };
              return yield* transaction.acknowledge({
                event: response,
                acknowledgedAt,
                requestId: input.requestId,
                payloadHash,
              });
            }),
          )
          .pipe(
            Effect.mapError((error) =>
              error._tag === "PersistenceError" ? infrastructureError(error) : error,
            ),
          );
      });

      return ActivityFeed.of({
        list,
        attention: repository.attention.pipe(Effect.mapError(infrastructureError)),
        acknowledge,
      });
    }),
  );
}
