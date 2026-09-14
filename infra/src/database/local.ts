import { fileURLToPath, URL } from "node:url";

import { Exec } from "alchemy/Command";
import * as Docker from "alchemy/Docker";
import * as Output from "alchemy/Output";
import { Effect, Redacted, Schema } from "effect";

export const localPostgres = Effect.gen(function* () {
  const volume = yield* Docker.Volume("PostgresData", {});
  const database = yield* Docker.Container("Postgres", {
    image: "postgres:17.6-alpine",
    environment: {
      POSTGRES_USER: "ironcage",
      POSTGRES_PASSWORD: Redacted.make("local-development"),
      POSTGRES_DB: "ironcage",
    },
    ports: [{ external: "127.0.0.1:", internal: 5432 }],
    volumes: [{ hostPath: volume.name, containerPath: "/var/lib/postgresql/data" }],
    start: true,
    healthcheck: { cmd: "pg_isready -U ironcage", interval: "1 second", retries: 30 },
  });
  const port = database.ports.pipe(
    Output.mapEffect((ports) =>
      Schema.decodeUnknownEffect(Schema.Int)(ports["5432/tcp"]).pipe(Effect.orDie),
    ),
  );
  yield* Exec("MigratePostgres", {
    command: "node src/database/migrate.ts",
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    env: {
      DATABASE_URL: Output.map(port, (value) =>
        Redacted.make(`postgres://ironcage:local-development@127.0.0.1:${value}/ironcage`),
      ),
    },
    memo: { include: ["../workers/api/migrations/**", "src/database/migrate.ts"] },
  });
  return {
    scheme: "postgres",
    host: "127.0.0.1",
    port,
    database: "ironcage",
    user: "ironcage",
    password: Redacted.make("local-development"),
    sslmode: "disable",
  } as const;
});
