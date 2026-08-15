import { DispatchRpcs, clientOverBinding, timeouts } from "@ironcage/contracts/client";
import { Cause, Effect } from "effect";

import {
  listPendingCategorizationDispatches,
  markCategorizationDispatched,
  recordCategorizationDispatchFailure,
} from "./money/categorization/dispatch";
import {
  encodeFeedEvent,
  listPendingFeedDispatches,
  markFeedDispatched,
  recordFeedDispatchFailure,
} from "./money/feed/dispatch";
import { Postgres } from "./persistence/postgres";
import { workerRequest } from "./runtime";

export const drainCategorizationDispatches = (env: Env) =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;
    const pending = yield* postgres.readTransaction((sql) =>
      listPendingCategorizationDispatches(sql, 50),
    );
    if (pending.length === 0) return { dispatched: 0, failed: 0 };

    const dispatch = yield* clientOverBinding(DispatchRpcs, {
      binding: env.AGENTS,
      surface: "agents",
      timeout: timeouts.coreToAgents,
    });

    let dispatched = 0;
    for (const item of pending) {
      const sent = yield* dispatch.dispatchCategorization(item).pipe(
        Effect.matchCauseEffect({
          onFailure: (cause) =>
            postgres
              .transaction((sql) =>
                recordCategorizationDispatchFailure(sql, item.runId, Cause.pretty(cause)),
              )
              .pipe(Effect.as(false)),
          onSuccess: () =>
            postgres
              .transaction((sql) => markCategorizationDispatched(sql, item.runId))
              .pipe(Effect.as(true)),
        }),
      );
      if (sent) dispatched += 1;
    }
    return { dispatched, failed: pending.length - dispatched };
  }).pipe(Effect.provide(Postgres.layerForRequest(env.DB.connectionString)), Effect.scoped);

export const drainFeedDispatches = (env: Env) =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;
    const pending = yield* postgres.readTransaction((sql) => listPendingFeedDispatches(sql, 100));
    if (pending.length === 0) return 0;

    const actor = env.FEEDS.getByName("operator");
    let dispatched = 0;
    for (const item of pending) {
      const sent = yield* Effect.promise(() => actor.publish(encodeFeedEvent(item.event))).pipe(
        Effect.matchCauseEffect({
          onFailure: (cause) =>
            postgres
              .transaction((sql) =>
                recordFeedDispatchFailure(sql, item.eventId, Cause.pretty(cause)),
              )
              .pipe(Effect.as(false)),
          onSuccess: () =>
            postgres
              .transaction((sql) => markFeedDispatched(sql, item.eventId))
              .pipe(Effect.as(true)),
        }),
      );
      if (sent) dispatched += 1;
    }
    return dispatched;
  }).pipe(Effect.provide(Postgres.layerForRequest(env.DB.connectionString)), Effect.scoped);

export const dispatchFeedInBackground = (env: Env) =>
  Effect.runPromise(
    drainFeedDispatches(env).pipe(
      Effect.catchCause((cause) => Effect.logWarning("feed dispatch failed", cause)),
    ),
  );

const dispatchCategorizationInBackground = (env: Env) =>
  Effect.runPromise(
    drainCategorizationDispatches(env).pipe(
      Effect.catchCause((cause) => Effect.logWarning("categorization dispatch failed", cause)),
    ),
  );

export const scheduleDispatch = (categorization = false) =>
  Effect.flatMap(workerRequest.service, ({ env, executionContext }) =>
    Effect.sync(() => {
      const pending: Promise<unknown>[] = [dispatchFeedInBackground(env)];
      if (categorization) pending.push(dispatchCategorizationInBackground(env));
      executionContext.waitUntil(Promise.all(pending).then(() => undefined));
    }),
  );
