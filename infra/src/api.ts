import { Stack } from "alchemy";
import { AlchemyContext } from "alchemy/AlchemyContext";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Planetscale from "alchemy/Planetscale";
import { RuntimeContext } from "alchemy/RuntimeContext";
import { Effect } from "effect";

import { api, type ApiOperations } from "../../workers/api/src/index.ts";

export type { WebOperation } from "../../workers/api/src/index.ts";
import { workerCompatibility, workerObservability } from "./cloudflare-config.ts";
import { localPostgres } from "./database/local.ts";
import { apiBindings } from "./worker-bindings.ts";

export const financialStorage = Effect.gen(function* () {
  if (globalThis.__ALCHEMY_RUNTIME__) {
    return {
      database: yield* Cloudflare.Hyperdrive.Connection.ref("RecordsConnection"),
      sources: yield* Cloudflare.R2.Bucket.ref("Sources"),
      exports: yield* Cloudflare.R2.Bucket.ref("TemporaryExports"),
    };
  }
  const { dev } = yield* AlchemyContext;
  const origin = dev
    ? yield* localPostgres
    : yield* Effect.gen(function* () {
        const database = yield* Planetscale.PostgresDatabase("Records", {
          clusterSize: "PS_10",
          majorVersion: "17",
          region: { slug: "ap-southeast" },
          migrations: "../workers/api/migrations",
        });
        const role = yield* Planetscale.PostgresRole("ApplicationRole", {
          database,
          inheritedRoles: ["pg_read_all_data", "pg_write_all_data"],
        });
        return role.origin;
      });
  const database = yield* Cloudflare.Hyperdrive.Connection("RecordsConnection", {
    origin,
    dev: origin,
    caching: { disabled: true },
  });
  const { stage } = yield* Stack;
  const sources = yield* Cloudflare.R2.Bucket("Sources", {
    forceDestroy: stage.startsWith("test-"),
  });
  const exports = yield* Cloudflare.R2.Bucket("TemporaryExports", {
    forceDestroy: true,
    lifecycleRules: [
      {
        id: "expire-exports",
        enabled: true,
        prefix: "",
        deleteObjectsTransition: { condition: { type: "Age", maxAge: 7 * 86400 } },
      },
    ],
  });
  return { database, sources, exports };
});

export class Api extends Cloudflare.Worker<Api, ApiOperations>()("ApiWorker") {}

export default Api.make(
  {
    main: import.meta.url,
    compatibility: workerCompatibility,
    workersDev: false,
    observability: workerObservability,
  },
  Effect.gen(function* () {
    const storage = yield* financialStorage;
    const bindings = yield* apiBindings(storage);
    const runtime = yield* Cloudflare.Worker;
    return yield* api(bindings).pipe(Effect.provideService(RuntimeContext, runtime));
  }).pipe(
    Effect.provide([Cloudflare.Hyperdrive.ConnectBinding, Cloudflare.R2.ReadWriteBucketBinding]),
  ),
);
