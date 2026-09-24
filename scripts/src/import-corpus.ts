#!/usr/bin/env node
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { ImportId, UploadResult } from "@repo/contracts/finance";
import { Console, Data, Duration, Effect, Schedule, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { FetchHttpClient, HttpBody, HttpClient } from "effect/unstable/http";
import pg from "pg";

const corpus = NodePath.resolve(import.meta.dirname, "../../fixtures/commbank");

class CorpusImportError extends Data.TaggedError("CorpusImportError")<{
  readonly message: string;
}> {}

const mediaType = (name: string) =>
  name.endsWith(".pdf")
    ? "application/pdf"
    : name.endsWith(".csv")
      ? "text/csv"
      : "application/x-ofx";
// Files of one CSV and OFX pair share their numeric prefix.
const pairKey = (name: string) => /^(\d+)[ab]_/.exec(name)?.[1] ?? null;

const ImportState = Schema.Struct({
  status: Schema.String,
  accountId: Schema.NullOr(Schema.String),
});

// Uploads the private corpus through the running web app, OFX files first so their
// envelopes create the accounts, then every other file in filename order. Prints
// aggregate counts only.
const command = Command.make(
  "corpus:import",
  {
    web: Flag.String("web").pipe(Flag.withDefault("http://localhost:1337")),
    database: Flag.String("database").pipe(
      Flag.withDefault("postgres://ironcage:local-development@127.0.0.1:54329/ironcage"),
    ),
  },
  Effect.fn(function* ({ web, database }) {
    if (!NodeFS.existsSync(corpus))
      return yield* new CorpusImportError({ message: "fixtures/commbank is missing." });
    const client = yield* Effect.acquireRelease(
      Effect.tryPromise(async () => {
        const connection = new pg.Client({ connectionString: database });
        await connection.connect();
        return connection;
      }),
      (connection) => Effect.promise(() => connection.end()),
    );
    const readImport = (importId: typeof ImportId.Type) =>
      Effect.tryPromise(() =>
        client.query(`SELECT status, account_id AS "accountId" FROM imports WHERE id = $1`, [
          importId,
        ]),
      ).pipe(
        Effect.flatMap((result) =>
          Schema.decodeUnknownEffect(Schema.Tuple([ImportState]))(result.rows),
        ),
        Effect.map(([row]) => row),
      );
    const upload = Effect.fn(function* (name: string, accountId: string | null) {
      const body = new FormData();
      if (accountId) body.set("accountId", accountId);
      body.set(
        "file",
        new Blob([NodeFS.readFileSync(NodePath.join(corpus, name))], { type: mediaType(name) }),
        name,
      );
      const response = yield* HttpClient.post(`${web}/uploads`, {
        body: HttpBody.formData(body),
        headers: { origin: web },
      });
      if (response.status !== 200)
        return yield* new CorpusImportError({
          message: `Upload of ${name} failed with HTTP ${response.status}.`,
        });
      const result = yield* response.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(UploadResult)),
      );
      const state = yield* readImport(result.importId).pipe(
        Effect.repeat({
          schedule: Schedule.spaced(Duration.millis(200)),
          while: (row) => row.status === "processing",
        }),
        Effect.timeout(Duration.minutes(2)),
      );
      if (state.status === "failed")
        return yield* new CorpusImportError({ message: `Import of ${name} failed.` });
      return state;
    });

    const files = NodeFS.readdirSync(corpus)
      .filter((name) => /\.(csv|ofx|pdf)$/.test(name))
      .sort();
    const pairAccounts = new Map<string, string>();
    for (const name of files.filter((file) => file.endsWith(".ofx"))) {
      const state = yield* upload(name, null);
      const key = pairKey(name);
      if (key && state.accountId) pairAccounts.set(key, state.accountId);
    }
    for (const name of files.filter((file) => !file.endsWith(".ofx"))) {
      const key = pairKey(name);
      const accountId = key ? (pairAccounts.get(key) ?? null) : null;
      if (name.endsWith(".csv") && !accountId)
        return yield* new CorpusImportError({ message: `No account for ${name}.` });
      yield* upload(name, accountId);
    }
    const counts = yield* Effect.tryPromise(() =>
      client.query(
        `SELECT (SELECT count(*)::int FROM accounts) AS accounts, (SELECT count(*)::int FROM postings) AS postings,
          (SELECT count(*)::int FROM observations) AS observations, (SELECT count(*)::int FROM events WHERE active) AS events,
          (SELECT count(*)::int FROM review_items WHERE resolved_at IS NULL AND import_id IS NOT NULL) AS "sourceReviews"`,
      ),
    );
    yield* Console.log(`Imported ${files.length} files`, counts.rows[0]);
  }, Effect.scoped),
);

Command.run(command, { version: "0.0.0" }).pipe(
  Effect.provide([NodeServices.layer, FetchHttpClient.layer]),
  NodeRuntime.runMain,
);
