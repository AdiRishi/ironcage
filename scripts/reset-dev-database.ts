#!/usr/bin/env node
// Empties the PlanetScale `dev` branch and re-applies every migration from
// `migrations/`, so the record is exactly what a first deploy would produce.
// Only ever targets `dev`: `main` is production and the branch is not a
// parameter here.
//
// Alchemy decides whether to run migrations from the file hashes in its own
// state, not from the database, so an emptied branch would otherwise stay
// empty until a migration file changed. This script therefore applies the
// files itself and records them in the ledger table exactly as Alchemy would
// (one transaction per file; `id` is a zero-padded sequence, `name` the file
// name), which keeps `pnpm dev` a no-op and the two in agreement.
//
// Requires `pscale` (authenticated) and `psql` on PATH — `brew install libpq`
// and add /opt/homebrew/opt/libpq/bin to PATH; PlanetScale's shell drives psql.
//
// Usage:
//   pnpm reset:dev-db
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const organization = "arishi-personal-org";
const database = "ironcage";
const branch = "dev";
const ledger = "__alchemy_migrations";

const migrationsDir = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../migrations",
);
const files = NodeFS.readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

const dropEverything = `
DO $$ DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
  END LOOP;
END $$;
CREATE TABLE ${ledger} (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const applyAll = files
  .map(
    (name, index) => `
BEGIN;
${NodeFS.readFileSync(NodePath.join(migrationsDir, name), "utf8")}
INSERT INTO ${ledger} (id, name) VALUES ('${String(index + 1).padStart(5, "0")}', '${name}');
COMMIT;
`,
  )
  .join("\n");

const script = `\\set ON_ERROR_STOP on
${dropEverything}
${applyAll}
SELECT id, name FROM ${ledger} ORDER BY id;
SELECT count(*) AS tables FROM pg_tables WHERE schemaname = 'public';
`;

const result = NodeChildProcess.spawnSync(
  "pscale",
  ["shell", database, branch, "--org", organization, "--role", "admin"],
  {
    input: script,
    encoding: "utf8",
    env: { ...process.env, PSCALE_ALLOW_NONINTERACTIVE_SHELL: "1" },
  },
);

if (result.error !== undefined) {
  console.error(`could not run pscale: ${result.error.message}`);
  process.exit(1);
}
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
if (result.status !== 0) {
  console.error(`pscale shell exited with ${result.status}`);
  process.exit(result.status ?? 1);
}

console.log(`\n${database}/${branch} reset: ${files.length} migrations applied from scratch.`);
