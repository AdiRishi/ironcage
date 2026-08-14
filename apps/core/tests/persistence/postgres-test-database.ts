import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, beforeEach } from "vitest";

const migrationsDirectory = resolve(import.meta.dirname, "../../../../migrations");

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

const applySchema = async (connectionString: string) => {
  const client = new pg.Client({ connectionString });
  const migrations = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  await client.connect();

  try {
    for (const migration of migrations) {
      const sql = await readFile(`${migrationsDirectory}/${migration}`, "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
};

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
    await applySchema(url);
  });

  afterAll(async () => {
    await container?.stop();
  });

  return { connectionString };
};
