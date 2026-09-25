import { CommandId, type ModelTask, type RecordModelUsage } from "@repo/contracts/finance";
import { Crypto, Effect } from "effect";
import { expect } from "vitest";

import { Enrichment } from "../../src/interpretation/enrichment.ts";
import { Models } from "../../src/models/service.ts";
import { applicationTest, syntheticProviders } from "../support/application.ts";
import { reset } from "../support/fixtures.ts";

const { test, services } = applicationTest();
const commandId = Crypto.Crypto.use((crypto) => crypto.randomUUIDv4).pipe(
  Effect.map((id) => CommandId.make(id)),
);
const call = Effect.fn(function* (
  task: ModelTask,
  usage: Pick<typeof RecordModelUsage.Type, "inputTokens" | "outputTokens" | "cost" | "status">,
) {
  return { commandId: yield* commandId, task, model: "synthetic", ...usage };
});
const usd = (minor: bigint) => ({ currency: "USD", minor });

test(
  "model usage totals only what calls reported, and lists tasks in the order Settings shows them",
  Effect.gen(function* () {
    yield* reset;
    const models = yield* Models;
    expect(yield* models.usage).toEqual({
      calls: 0,
      inputTokens: null,
      outputTokens: null,
      unknownUsage: 0,
      costs: [],
      tasks: [],
      recent: [],
    });
    yield* models.record(
      yield* call("enrichment", {
        inputTokens: 1000n,
        outputTokens: 200n,
        cost: usd(2n),
        status: "success",
      }),
    );
    yield* models.record(
      yield* call("analyst", {
        inputTokens: 10n,
        outputTokens: 20n,
        cost: usd(9007199254740993n),
        status: "success",
      }),
    );
    const failed = { inputTokens: null, outputTokens: null, cost: null, status: "failed" } as const;
    yield* models.record(yield* call("analyst", failed));
    yield* models.record(yield* call("briefing", failed));
    const usage = yield* models.usage;
    expect(usage).toMatchObject({
      calls: 4,
      inputTokens: 1010n,
      outputTokens: 220n,
      unknownUsage: 2,
      costs: [usd(9007199254740995n)],
      tasks: [
        {
          task: "enrichment",
          calls: 1,
          inputTokens: 1000n,
          outputTokens: 200n,
          unknownUsage: 0,
          costs: [usd(2n)],
        },
        {
          task: "analyst",
          calls: 2,
          inputTokens: 10n,
          outputTokens: 20n,
          unknownUsage: 1,
          costs: [usd(9007199254740993n)],
        },
        {
          task: "briefing",
          calls: 1,
          inputTokens: null,
          outputTokens: null,
          unknownUsage: 1,
          costs: [],
        },
      ],
    });
    expect(
      usage.recent.find((entry) => entry.task === "analyst" && entry.status === "failed"),
    ).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      cost: null,
    });
  }).pipe(Effect.provide(services)),
);

test(
  "recording the same model call again stores it once",
  Effect.gen(function* () {
    yield* reset;
    const models = yield* Models;
    const input = yield* call("analyst", {
      inputTokens: 1200n,
      outputTokens: 90n,
      cost: usd(1n),
      status: "success",
    });
    const first = yield* models.record(input);
    expect(yield* models.record(input)).toEqual(first);
    expect(yield* models.usage).toMatchObject({ calls: 1, costs: [usd(1n)] });
  }).pipe(Effect.provide(services)),
);

test(
  "each task may call its model only while its own switch is on",
  Effect.gen(function* () {
    yield* reset;
    const models = yield* Models;
    const refused = { allowed: false, message: "The analyst is off. Turn it on in Settings." };
    expect(yield* models.allowance({ task: "analyst" })).toEqual(refused);
    expect(yield* models.allowance({ task: "briefing" })).toEqual(refused);
    const identification = { allowed: true, provider: syntheticProviders.enrichment };
    expect(yield* models.allowance({ task: "enrichment" })).toEqual(identification);
    expect(yield* models.allowance({ task: "evaluation" })).toEqual(identification);

    const settings = yield* models.settings;
    yield* models.updateSettings({
      commandId: yield* commandId,
      enrichment: { enabled: false, autoApplyConfidence: 0.8 },
      analyst: { enabled: true },
      warning: settings.warning,
      expectedVersion: settings.version,
    });
    const analyst = { allowed: true, provider: syntheticProviders.analyst };
    expect(yield* models.allowance({ task: "analyst" })).toEqual(analyst);
    expect(yield* models.allowance({ task: "briefing" })).toEqual(analyst);
    expect(yield* models.allowance({ task: "evaluation" })).toEqual({
      allowed: false,
      message: "Counterparty identification is switched off. Turn it on in Settings.",
    });
  }).pipe(Effect.provide(services)),
);

test(
  "once every task's usage together reaches the warning, no task may call its model",
  Effect.gen(function* () {
    yield* reset;
    const models = yield* Models;
    const settings = yield* models.settings;
    expect(settings.warning).toEqual(usd(2000n));
    yield* models.updateSettings({
      commandId: yield* commandId,
      enrichment: { enabled: true, autoApplyConfidence: 0.8 },
      analyst: { enabled: true },
      warning: settings.warning,
      expectedVersion: settings.version,
    });
    yield* models.record(
      yield* call("enrichment", {
        inputTokens: 1000n,
        outputTokens: 200n,
        cost: usd(1200n),
        status: "success",
      }),
    );
    yield* models.record(
      yield* call("analyst", {
        inputTokens: 1000n,
        outputTokens: 200n,
        cost: usd(799n),
        status: "success",
      }),
    );
    expect(yield* models.allowance({ task: "analyst" })).toMatchObject({ allowed: true });

    yield* models.record(
      yield* call("briefing", {
        inputTokens: 100n,
        outputTokens: 20n,
        cost: usd(1n),
        status: "success",
      }),
    );
    const refused = {
      allowed: false,
      message: "Model usage reached the warning in Settings. Raise it to continue.",
    };
    for (const task of ["enrichment", "evaluation", "analyst", "briefing"] as const)
      expect(yield* models.allowance({ task })).toEqual(refused);
    const request = yield* (yield* Enrichment)
      .request({ commandId: yield* commandId })
      .pipe(Effect.flip);
    expect(request).toMatchObject({ kind: "unavailable", message: refused.message });
  }).pipe(Effect.provide(services)),
);

test(
  "model settings saved from an older version are refused and change nothing",
  Effect.gen(function* () {
    yield* reset;
    const models = yield* Models;
    const original = yield* models.settings;
    const input = {
      commandId: yield* commandId,
      enrichment: { enabled: true, autoApplyConfidence: 0.9 },
      analyst: { enabled: true },
      warning: usd(5000n),
      expectedVersion: original.version,
    };
    const saved = yield* models.updateSettings(input);
    expect(saved).toMatchObject({
      enrichment: { enabled: true, autoApplyConfidence: 0.9 },
      analyst: { enabled: true },
      warning: usd(5000n),
      version: original.version + 1,
    });
    expect(yield* models.updateSettings(input)).toEqual(saved);
    const stale = yield* models
      .updateSettings({ ...input, commandId: yield* commandId, analyst: { enabled: false } })
      .pipe(Effect.flip);
    expect(stale.kind).toBe("stale");
    expect(yield* models.settings).toEqual(saved);
  }).pipe(Effect.provide(services)),
);

test(
  "a usage warning that is not a positive amount in US dollars is refused and changes nothing",
  Effect.gen(function* () {
    yield* reset;
    const models = yield* Models;
    const original = yield* models.settings;
    for (const warning of [{ currency: "AUD", minor: 2000n }, usd(0n)]) {
      const refused = yield* models
        .updateSettings({
          commandId: yield* commandId,
          enrichment: { enabled: true, autoApplyConfidence: 0.8 },
          analyst: { enabled: false },
          warning,
          expectedVersion: original.version,
        })
        .pipe(Effect.flip);
      expect(refused.kind).toBe("invalid");
    }
    expect(yield* models.settings).toEqual(original);
  }).pipe(Effect.provide(services)),
);
