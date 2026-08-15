import { makeWorkerRequestContext, systemPingHandler } from "@ironcage/contracts/server";
import { Sha256 } from "@ironcage/domain";
import { Effect, Schema } from "effect";

import { sha256Hex } from "./money/import/bytes";
import { persistenceToBoundary } from "./persistence/error";
import { Postgres } from "./persistence/postgres";

export const worker = "ironcage-core";
export const workerRequest = makeWorkerRequestContext<Env, ExecutionContext>(
  "ironcage/core/WorkerRequest",
);

export const ping = (surface: string) =>
  Effect.flatMap(workerRequest.service, () => systemPingHandler({ worker, surface }));

export const runCoreRequest = <A, E>(use: (env: Env) => Effect.Effect<A, E, Postgres>) =>
  Effect.flatMap(workerRequest.service, ({ env }) =>
    use(env).pipe(
      Effect.provide(Postgres.layerForRequest(env.DB.connectionString)),
      persistenceToBoundary,
    ),
  );

const decodeSha = Schema.decodeUnknownSync(Sha256);

export const payloadHash = (value: unknown) =>
  Effect.promise(() => sha256Hex(new TextEncoder().encode(JSON.stringify(value)))).pipe(
    Effect.map(decodeSha),
  );
