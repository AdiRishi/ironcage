import { it } from "@effect/vitest";
import { FeedEvent, RequestId, type FeedEvent as FeedEventType } from "@ironcage/domain";
import { Effect, Layer, Ref, Schema } from "effect";
import { describe, expect } from "vitest";

import { ActivityFeed } from "../src/activity/activity";
import { ActivityRepository } from "../src/activity/repository";
import { MoneyCryptography } from "../src/money/crypto";
import type { StoredRequest } from "../src/persistence";

const requestId = (suffix: string) =>
  Schema.decodeUnknownSync(RequestId)(`018f0000-0000-7000-8000-${suffix.padStart(12, "0")}`);

const event = (suffix: string, severity: "info" | "critical") =>
  Schema.decodeUnknownSync(FeedEvent)({
    id: `018f0000-0000-7000-8000-${suffix.padStart(12, "0")}`,
    occurredAt: "2026-08-11T10:00:00.000Z",
    origin: "money",
    category: "money",
    eventType: "bank_import_completed",
    severity,
    summary: `${severity} event`,
    payload: {},
    links: null,
    acknowledgedAt: null,
  });

interface ActivityState {
  readonly events: readonly FeedEventType[];
  readonly requests: readonly StoredRequest[];
  readonly acknowledgmentCommits: number;
}

const informationalEvent = event("1", "info");
const criticalEvent = event("2", "critical");

const makeActivityTestKit = Effect.gen(function* () {
  const state = yield* Ref.make<ActivityState>({
    events: [informationalEvent, criticalEvent],
    requests: [],
    acknowledgmentCommits: 0,
  });
  const repository = ActivityRepository.of({
    list: (query) =>
      Ref.get(state).pipe(
        Effect.map((current) => ({
          events: current.events.slice(0, query.limit),
          nextCursor: null,
        })),
      ),
    attention: Ref.get(state).pipe(
      Effect.map((current) =>
        current.events.filter(
          (candidate) => candidate.severity === "critical" && candidate.acknowledgedAt === null,
        ),
      ),
    ),
    withTransaction: (use) =>
      use({
        request: (id) =>
          Ref.get(state).pipe(
            Effect.map(
              (current) => current.requests.find((request) => request.requestId === id) ?? null,
            ),
          ),
        event: (id) =>
          Ref.get(state).pipe(
            Effect.map(
              (current) => current.events.find((candidate) => candidate.id === id) ?? null,
            ),
          ),
        acknowledge: (plan) =>
          Ref.update(state, (current) => ({
            events: current.events.map((candidate) =>
              candidate.id === plan.event.id ? plan.event : candidate,
            ),
            requests: [
              ...current.requests,
              {
                requestId: plan.requestId,
                operation: "activity.acknowledge",
                payloadHash: plan.payloadHash,
                response: Schema.encodeSync(FeedEvent)(plan.event),
              },
            ],
            acknowledgmentCommits: current.acknowledgmentCommits + 1,
          })).pipe(Effect.as(plan.event)),
      }),
  });
  const dependencies = Layer.mergeAll(
    Layer.succeed(ActivityRepository, repository),
    MoneyCryptography.layer("test-only-money-identity-key-at-least-32-bytes"),
  );

  return { state, layer: ActivityFeed.layer.pipe(Layer.provide(dependencies)) };
});

describe("ActivityFeed", () => {
  it.effect("acknowledges critical events idempotently and rejects request collisions", () =>
    Effect.gen(function* () {
      const kit = yield* makeActivityTestKit;

      yield* Effect.gen(function* () {
        const activity = yield* ActivityFeed;
        const page = yield* activity.list({
          cursor: null,
          limit: 10,
          origins: [],
          categories: [],
          severities: [],
          occurredFrom: null,
          occurredThrough: null,
          search: null,
        });
        expect(page.events).toHaveLength(2);

        const invalid = yield* Effect.flip(
          activity.acknowledge({ eventId: informationalEvent.id, requestId: requestId("1") }),
        );
        expect(invalid).toMatchObject({
          _tag: "ValidationFailed",
          reason: "AcknowledgmentNotRequired",
        });

        const input = { eventId: criticalEvent.id, requestId: requestId("2") };
        const acknowledged = yield* activity.acknowledge(input);
        expect(acknowledged.acknowledgedAt).not.toBeNull();
        expect(yield* activity.acknowledge(input)).toEqual(acknowledged);
        expect(yield* activity.attention).toEqual([]);
        expect((yield* Ref.get(kit.state)).acknowledgmentCommits).toBe(1);

        const collision = yield* Effect.flip(
          activity.acknowledge({ eventId: informationalEvent.id, requestId: requestId("2") }),
        );
        expect(collision).toMatchObject({ _tag: "Conflict", reason: "RequestIdCollision" });
      }).pipe(Effect.provide(kit.layer));
    }),
  );
});
