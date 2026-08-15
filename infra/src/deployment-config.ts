import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Function from "effect/Function";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import type { CoreSecrets } from "./worker-bindings.ts";

const Stage = Schema.Literals(["dev", "prod"]);

export const decodeStage = Function.flow(
  Schema.decodeUnknownEffect(Stage),
  Effect.mapError((error) => new Config.ConfigError(error)),
);

const optionalSecret = (name: string) =>
  Config.redacted(name).pipe(
    Config.option,
    Config.map(Option.filter((value) => Redacted.value(value).length > 0)),
  );

const coreSecretNames = [
  "KRAKEN_KEY",
  "KRAKEN_SECRET",
  "KRAKEN_EXPORT_KEY",
  "KRAKEN_EXPORT_SECRET",
  "ALPACA_KEY",
  "ALPACA_SECRET",
  "EMAIL_KEY",
] as const satisfies ReadonlyArray<keyof CoreSecrets>;

const coreSecrets = Effect.gen(function* () {
  const secrets: {
    -readonly [Key in keyof CoreSecrets]: CoreSecrets[Key];
  } = {};

  for (const name of coreSecretNames) {
    const value = yield* optionalSecret(name);
    if (Option.isSome(value)) secrets[name] = value.value;
  }

  return secrets;
});

interface SharedConfig {
  readonly gatewayLogLimit: number;
  readonly gatewayWeeklySpendLimitDollars: number;
}

export interface DevelopmentConfig extends SharedConfig {
  readonly _tag: "Development";
  readonly stage: "dev";
  readonly environment: "local";
}

export interface ProductionConfig extends SharedConfig {
  readonly _tag: "Production";
  readonly stage: "prod";
  readonly environment: "production";
  readonly accessEmail: string;
  readonly coreSecrets: CoreSecrets;
  readonly domain: "wealth.arishi.dev";
}

export type DeploymentConfig = DevelopmentConfig | ProductionConfig;

export const deploymentConfig = Effect.fn("Ironcage.DeploymentConfig")(function* () {
  const stack = yield* Alchemy.Stack;
  const stage = yield* decodeStage(stack.stage);
  const shared = yield* Effect.all({
    gatewayLogLimit: Config.number("AI_GATEWAY_LOG_LIMIT").pipe(Config.withDefault(10_000)),
    gatewayWeeklySpendLimitDollars: Config.number("AI_GATEWAY_WEEKLY_SPEND_DOLLARS").pipe(
      Config.withDefault(50),
    ),
  });

  if (stage === "dev") {
    return {
      _tag: "Development",
      stage,
      environment: "local",
      ...shared,
    } satisfies DevelopmentConfig;
  }

  return {
    _tag: "Production",
    stage,
    environment: "production",
    accessEmail: yield* Config.string("ACCESS_EMAIL"),
    coreSecrets: yield* coreSecrets,
    domain: "wealth.arishi.dev",
    ...shared,
  } satisfies ProductionConfig;
});
