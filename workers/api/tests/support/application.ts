import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { PgClient } from "@effect/sql-pg";
import { localPostgres } from "@repo/infra/database/local";
import { localDatabaseProviders } from "@repo/infra/database/providers";
import * as Alchemy from "alchemy";
import * as Test from "alchemy/Test/Vitest";
import { Effect, Layer, Redacted } from "effect";

import { AccountHistory } from "../../src/accounts/periods.ts";
import { AccountResolution } from "../../src/accounts/resolution.ts";
import { Accounts } from "../../src/accounts/service.ts";
import { ClassificationConfig } from "../../src/classification/config.ts";
import { Classification } from "../../src/classification/service.ts";
import { Commands } from "../../src/database/commands.ts";
import { Corrections } from "../../src/events/corrections.ts";
import { Events } from "../../src/events/service.ts";
import { Publication } from "../../src/imports/publication.ts";
import { ClassificationJobs } from "../../src/platform/services.ts";
import { Postings } from "../../src/postings/service.ts";
import { References } from "../../src/references/service.ts";
import { InterpretationReviews } from "../../src/relationships/reviews.ts";
import { Relationships } from "../../src/relationships/service.ts";
import { Reviews } from "../../src/review/service.ts";
import { Rules } from "../../src/rules/service.ts";
import { Settings } from "../../src/settings/service.ts";

const databaseProviders = localDatabaseProviders;
const Stack = Alchemy.Stack(
  "PublicationTest",
  { providers: databaseProviders, state: Alchemy.localState() },
  Effect.gen(function* () {
    const database = yield* localPostgres;
    return { port: database.port };
  }),
);

export function applicationTest() {
  const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
    providers: databaseProviders,
    stage: `test-${crypto.randomUUID().slice(0, 8)}`,
    dev: true,
  });
  const stack = beforeAll(deploy(Stack), { timeout: 600_000 });
  afterAll(destroy(Stack), { timeout: 600_000 });
  const database = Layer.unwrap(
    Effect.map(stack, ({ port }) =>
      PgClient.layer({
        host: "127.0.0.1",
        port,
        username: "ironcage",
        database: "ironcage",
        password: Redacted.make("local-development"),
      }),
    ),
  );
  const services = Layer.mergeAll(
    Accounts.layer,
    AccountHistory.layer,
    Events.layer,
    Corrections.layer,
    References.layer,
    Rules.layer,
    Relationships.layer,
    InterpretationReviews.layer,
    Postings.layer,
    Reviews.layer,
    Settings.layer,
    Classification.layer,
  ).pipe(
    Layer.provideMerge(Publication.layer),
    Layer.provideMerge(Commands.layer),
    Layer.provide(AccountResolution.layer),
    Layer.provideMerge(database),
    Layer.provide(
      Layer.succeed(ClassificationConfig, {
        provider: {
          name: "Synthetic provider",
          model: "synthetic",
          inputMicrousdPerMillion: 270000n,
          outputMicrousdPerMillion: 850000n,
        },
      }),
    ),
    Layer.provide(
      Layer.succeed(ClassificationJobs, {
        start: () => Effect.void,
        status: () => Effect.succeed({ status: "running", failure: null }),
      }),
    ),
    Layer.provideMerge(NodeCrypto.layer),
  );

  return { test, services };
}
