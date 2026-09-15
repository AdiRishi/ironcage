import { PgClient } from "@effect/sql-pg";
import { Effect, Layer } from "effect";
import { expect } from "vitest";

import { Models } from "../../src/models/service.ts";
import { applicationTest } from "../support/application.ts";

const { test, services } = applicationTest();
test(
  "model usage keeps unknown reports separate and totals costs by currency without rounding",
  Effect.gen(function* () {
    const models = yield* Models;
    const initial = yield* models.get;
    expect(initial).toMatchObject({
      enabled: false,
      provider: null,
      calls: 0,
      costs: [],
      recent: [],
      warning: null,
    });
    const sql = yield* PgClient.PgClient;
    yield* sql`INSERT INTO model_usage (id, task, model, input_tokens, output_tokens, cost_minor, cost_currency, status) VALUES ('a72121c9-940d-4d3d-acbf-9a5cb864eb39', 'document', 'synthetic', 10, 20, 9007199254740993, 'AUD', 'success'), ('ba5048b5-35d9-40db-90d4-398b43dc457b', 'document', 'synthetic', NULL, NULL, NULL, NULL, 'failed')`;
    const usage = yield* models.get;
    expect(usage.calls).toBe(2);
    expect(usage.inputTokens).toBe(10n);
    expect(usage.outputTokens).toBe(20n);
    expect(usage.unknownUsage).toBe(1);
    expect(usage.costs).toEqual([{ currency: "AUD", minor: 9007199254740993n }]);
    expect(usage.recent.find((entry) => entry.status === "failed")).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      cost: null,
    });
  }).pipe(Effect.provide(Models.layer.pipe(Layer.provideMerge(services)))),
);

test(
  "a configured model warning retains its exact amount and reporting currency",
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    yield* sql`UPDATE settings SET reporting_currency = 'JPY', ai_warning_minor = 9007199254740993 WHERE id = 1`;
    const models = yield* Models;
    expect((yield* models.get).warning).toEqual({
      currency: "JPY",
      minor: 9007199254740993n,
    });
  }).pipe(Effect.provide(Models.layer.pipe(Layer.provideMerge(services)))),
);
