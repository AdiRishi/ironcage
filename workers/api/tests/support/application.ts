import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { PgClient } from "@effect/sql-pg";
import { localPostgres } from "@repo/infra/database/local";
import { localDatabaseProviders } from "@repo/infra/database/providers";
import * as Alchemy from "alchemy";
import * as Test from "alchemy/Test/Vitest";
import { Effect, Layer, Redacted } from "effect";
import type { SqlClient } from "effect/unstable/sql";

import { AccountHistory } from "../../src/accounts/periods.ts";
import { AccountResolution } from "../../src/accounts/resolution.ts";
import { Accounts } from "../../src/accounts/service.ts";
import { Flows } from "../../src/analysis/flows.ts";
import { FactRebuilds } from "../../src/analysis/rebuild.ts";
import { Spending } from "../../src/analysis/spending.ts";
import { Commands } from "../../src/database/commands.ts";
import { Corrections } from "../../src/events/corrections.ts";
import { Events } from "../../src/events/service.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Counterparties } from "../../src/interpretation/counterparties.ts";
import { CounterpartyHistory } from "../../src/interpretation/counterparty-history.ts";
import { Enrichment } from "../../src/interpretation/enrichment.ts";
import { Questions } from "../../src/interpretation/questions.ts";
import { Models } from "../../src/models/service.ts";
import { EnrichmentJobs, FactJobs, ModelProviders } from "../../src/platform/services.ts";
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
  const services = applicationServices(database);
  return { test, services, stack };
}

// Each feature has its own model and prices, so a task given the other feature's model
// fails the tests.
export const syntheticProviders = {
  enrichment: {
    name: "Synthetic provider",
    model: "synthetic-identification",
    inputMicrousdPerMillion: 150_000n,
    cachedInputMicrousdPerMillion: 30_000n,
    outputMicrousdPerMillion: 500_000n,
  },
  analyst: {
    name: "Synthetic provider",
    model: "synthetic-analyst",
    inputMicrousdPerMillion: 300_000n,
    cachedInputMicrousdPerMillion: 60_000n,
    outputMicrousdPerMillion: 1_200_000n,
  },
};

export const applicationServices = <E>(
  database: Layer.Layer<PgClient.PgClient | SqlClient.SqlClient, E>,
) =>
  Layer.mergeAll(
    Flows.layer,
    Spending.layer,
    FactRebuilds.layer,
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
    Counterparties.layer,
    CounterpartyHistory.layer,
    Questions.layer,
    Enrichment.layer,
    Models.layer,
  ).pipe(
    Layer.provideMerge(Publication.layer),
    Layer.provideMerge(Commands.layer),
    Layer.provide(AccountResolution.layer),
    Layer.provideMerge(database),
    Layer.provide(Layer.succeed(ModelProviders, syntheticProviders)),
    Layer.provide(
      Layer.succeed(FactJobs, {
        start: () => Effect.void,
        status: () => Effect.succeed({ status: "running", failure: null }),
      }),
    ),
    Layer.provide(
      Layer.succeed(EnrichmentJobs, {
        start: () => Effect.void,
        status: () => Effect.succeed({ status: "running", failure: null }),
      }),
    ),
    Layer.provideMerge(NodeCrypto.layer),
  );
