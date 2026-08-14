import { execFile } from "node:child_process";
import { URL, fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, beforeEach } from "vitest";

const execFileAsync = promisify(execFile);
const migrationEntrypoint = fileURLToPath(
  new URL("../../../../scripts/migrate.ts", import.meta.url),
);
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const resetSchema = async (connectionString: string) => {
  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public AUTHORIZATION current_user");
  } finally {
    await client.end();
  }
};

const applyMigrations = (connectionString: string) =>
  execFileAsync(process.execPath, [migrationEntrypoint, "--apply"], {
    cwd: repositoryRoot,
    env: { ...process.env, DATABASE_URL: connectionString },
  });

export const usePostgresTestDatabase = () => {
  let container: StartedPostgreSqlContainer | undefined;

  const connectionString = () => {
    if (container === undefined) throw new Error("Postgres test container has not started");
    return container.getConnectionUri();
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:18.4-alpine")
      .withDatabase("ironcage")
      .withUsername("ironcage")
      .withPassword("ironcage")
      .start();
  });

  beforeEach(async () => {
    const url = connectionString();
    // Workers storage isolation cannot reach an external database, so the
    // Postgres test boundary owns destruction and migration explicitly.
    await resetSchema(url);
    await applyMigrations(url);
  });

  afterAll(async () => {
    await container?.stop();
  });

  return { connectionString };
};
