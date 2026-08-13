import { describe, expect, test } from "vitest";

import { configFor } from "../../../lib/migrations/database.ts";

describe("configFor", () => {
  test("leaves ordinary Postgres connection strings to node-postgres", () => {
    const connectionString =
      "postgres://operator:secret@aws.connect.psdb.cloud/ironcage?sslmode=verify-full";

    expect(configFor(connectionString)).toStrictEqual({ connectionString });
  });

  test("preserves explicit certificate paths", () => {
    const connectionString =
      "postgres://operator:secret@localhost/ironcage?sslmode=verify-full&sslrootcert=%2Fetc%2Fssl%2Fca.pem";

    expect(configFor(connectionString)).toStrictEqual({ connectionString });
  });

  test("uses Node's system trust store for verified connections", () => {
    expect(
      configFor(
        "postgres://operator:secret@aws.connect.psdb.cloud/ironcage?sslmode=verify-full&sslrootcert=system",
      ),
    ).toStrictEqual({
      connectionString: "postgres://operator:secret@aws.connect.psdb.cloud/ironcage",
      ssl: { rejectUnauthorized: true },
    });
  });

  test("honors permissive system-store modes", () => {
    expect(
      configFor(
        "postgres://operator:secret@aws.connect.psdb.cloud/ironcage?sslmode=require&sslrootcert=system",
      ),
    ).toStrictEqual({
      connectionString: "postgres://operator:secret@aws.connect.psdb.cloud/ironcage",
      ssl: { rejectUnauthorized: false },
    });
  });

  test("honors disabled system-store mode", () => {
    expect(
      configFor("postgres://operator:secret@localhost/ironcage?sslmode=disable&sslrootcert=system"),
    ).toStrictEqual({
      connectionString: "postgres://operator:secret@localhost/ironcage",
      ssl: false,
    });
  });
});
