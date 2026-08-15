import { expect, it } from "@effect/vitest";
import { BankAccountId, RequestId, Sha256 } from "@ironcage/domain";
import { Effect, Schema } from "effect";

import { mintId } from "../../src/ids";
import { configureBankAccount } from "../../src/money/accounts/service";
import { archiveBankStatement, statementArchiveKey } from "../../src/money/statements/service";
import { Postgres } from "../../src/persistence/postgres";
import { usePostgresTestDatabase } from "../persistence/postgres-test-database";

const database = usePostgresTestDatabase();
const sha = Schema.decodeUnknownSync(Sha256);
const storedArtifacts = new Map<string, Uint8Array>();
const artifacts = {
  put: (key: string, bytes: Uint8Array) => {
    storedArtifacts.set(key, bytes);
    return Promise.resolve();
  },
};

const withDatabase = <A, E>(effect: Effect.Effect<A, E, Postgres>) =>
  effect.pipe(Effect.provide(Postgres.layerForRequest(database.connectionString())));

it.effect("archives a statement once without adding it to the transaction record", () =>
  Effect.gen(function* () {
    storedArtifacts.clear();
    const account = yield* withDatabase(
      configureBankAccount({
        requestId: yield* mintId(RequestId),
        payloadHash: sha("a".repeat(64)),
        productLabel: "Statement archive account",
        accountType: "deposit",
        required: true,
        openedOn: null,
        closedOn: null,
      }),
    );
    const pdf = new TextEncoder().encode("%PDF-1.4\narchival fixture");

    const first = yield* withDatabase(
      archiveBankStatement(
        {
          requestId: yield* mintId(RequestId),
          accountId: account.id,
          pdf: { displayName: "Statement.pdf", bytes: pdf },
        },
        artifacts,
      ),
    );
    const replay = yield* withDatabase(
      archiveBankStatement(
        {
          requestId: yield* mintId(RequestId),
          accountId: account.id,
          pdf: { displayName: "Statement.pdf", bytes: pdf },
        },
        artifacts,
      ),
    );

    expect(replay.id).toBe(first.id);
    expect(storedArtifacts.get(statementArchiveKey(first.digest))).toEqual(pdf);

    const counts = yield* withDatabase(
      Effect.gen(function* () {
        const postgres = yield* Postgres;
        const [archives] = yield* postgres.query(
          "count statement archives",
          "SELECT count(*)::integer AS count FROM bank_statement_archives",
        );
        const [events] = yield* postgres.query(
          "count statement archive events",
          "SELECT count(*)::integer AS count FROM feed_events WHERE event_type = 'bank_statement_archived'",
        );
        const [imports] = yield* postgres.query(
          "count bank imports",
          "SELECT count(*)::integer AS count FROM bank_imports",
        );
        return { archives, events, imports };
      }),
    );
    expect(counts.archives?.count).toBe(1);
    expect(counts.events?.count).toBe(1);
    expect(counts.imports?.count).toBe(0);
  }),
);

it.effect("rejects non-PDF bytes before writing an artifact", () =>
  Effect.gen(function* () {
    storedArtifacts.clear();
    const error = yield* Effect.flip(
      withDatabase(
        archiveBankStatement(
          {
            requestId: yield* mintId(RequestId),
            accountId: yield* mintId(BankAccountId),
            pdf: {
              displayName: "not-a-statement.pdf",
              bytes: new TextEncoder().encode("not a PDF"),
            },
          },
          artifacts,
        ),
      ),
    );

    expect(error).toMatchObject({ _tag: "ValidationFailed", reason: "InvalidStatement" });
    expect(storedArtifacts.size).toBe(0);
  }),
);
