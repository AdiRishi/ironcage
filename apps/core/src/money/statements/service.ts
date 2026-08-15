import {
  BankStatementArchive,
  NotFound,
  ValidationFailed,
  type UploadedBytes,
} from "@ironcage/contracts/schema";
import {
  BankStatementArchiveId,
  BankAccountId,
  FeedEventId,
  maximumStatementBytes,
  Sha256,
  type RequestId,
} from "@ironcage/domain";
import { Effect, Schema } from "effect";

import { mintId } from "../../ids";
import { runIdempotentMutation } from "../../persistence/app-requests";
import { PersistenceError, persistenceToBoundary } from "../../persistence/error";
import { decodeRows, Postgres, type SqlExecutor } from "../../persistence/postgres";
import { getAccount } from "../accounts/repository";
import type { ArtifactStore } from "../artifacts";
import { insertFeedEvent } from "../feed/repository";
import { sha256Hex } from "../import/bytes";

const decodeSha = Schema.decodeUnknownSync(Sha256);

const StatementArchiveRow = Schema.Struct({
  id: BankStatementArchiveId,
  accountId: BankAccountId,
  displayName: Schema.String,
  digest: Sha256,
  byteSize: Schema.Int,
  archivedAt: Schema.DateTimeUtcFromDate,
});

const readArchive = (sql: SqlExecutor, accountId: BankAccountId, digest: Sha256) =>
  Effect.gen(function* () {
    const rows = yield* sql.query(
      "read statement archive",
      `SELECT id, account_id AS "accountId", display_name AS "displayName",
              byte_digest AS digest, byte_size AS "byteSize", archived_at AS "archivedAt"
         FROM bank_statement_archives
        WHERE account_id = $1 AND byte_digest = $2`,
      [accountId, digest],
    );
    return (yield* decodeRows("decode statement archive", StatementArchiveRow, rows))[0];
  });

export const statementArchiveKey = (digest: Sha256) => `exports/commbank/statements/${digest}.pdf`;

export const archiveBankStatement = (
  input: {
    readonly requestId: RequestId;
    readonly accountId: BankAccountId;
    readonly pdf: UploadedBytes;
  },
  artifacts: ArtifactStore,
) =>
  Effect.gen(function* () {
    if (input.pdf.displayName.trim().length === 0) {
      return yield* Effect.fail(
        new ValidationFailed({ reason: "InvalidStatement", detail: "file name is required" }),
      );
    }
    if (input.pdf.bytes.length === 0 || input.pdf.bytes.length > maximumStatementBytes) {
      return yield* Effect.fail(
        new ValidationFailed({
          reason: "InvalidStatement",
          detail: "statement must be a non-empty PDF no larger than 25 MiB",
        }),
      );
    }
    if (new TextDecoder().decode(input.pdf.bytes.subarray(0, 5)) !== "%PDF-") {
      return yield* Effect.fail(
        new ValidationFailed({ reason: "InvalidStatement", detail: "file is not a PDF" }),
      );
    }

    const postgres = yield* Postgres;
    const account = yield* postgres.readTransaction((sql) =>
      Effect.gen(function* () {
        const found = yield* getAccount(sql, input.accountId);
        if (found === null) {
          return yield* Effect.fail(new NotFound({ entity: "bank account", id: input.accountId }));
        }
        return found;
      }),
    );
    const digest = decodeSha(yield* Effect.promise(() => sha256Hex(input.pdf.bytes)));
    const r2Key = statementArchiveKey(digest);
    yield* Effect.tryPromise({
      try: () => artifacts.put(r2Key, input.pdf.bytes),
      catch: (cause) => new PersistenceError({ operation: "archive bank statement", cause }),
    });
    const payloadHash = decodeSha(
      yield* Effect.promise(() =>
        sha256Hex(
          new TextEncoder().encode(
            JSON.stringify({
              accountId: input.accountId,
              displayName: input.pdf.displayName,
              digest,
            }),
          ),
        ),
      ),
    );

    return yield* runIdempotentMutation(
      {
        requestId: input.requestId,
        operation: "archiveBankStatement",
        payloadHash,
        response: BankStatementArchive,
      },
      (sql) =>
        Effect.gen(function* () {
          const id = yield* mintId(BankStatementArchiveId);
          const rows = yield* sql.query(
            "archive bank statement",
            `INSERT INTO bank_statement_archives
               (id, account_id, display_name, byte_digest, byte_size, r2_key, archived_at)
             VALUES ($1, $2, $3, $4, $5, $6, now())
             ON CONFLICT (account_id, byte_digest) DO NOTHING
             RETURNING id, account_id AS "accountId", display_name AS "displayName",
                       byte_digest AS digest, byte_size AS "byteSize", archived_at AS "archivedAt"`,
            [id, input.accountId, input.pdf.displayName, digest, input.pdf.bytes.length, r2Key],
          );
          const inserted = (yield* decodeRows(
            "decode statement archive",
            StatementArchiveRow,
            rows,
          ))[0];
          if (inserted !== undefined) {
            yield* insertFeedEvent(sql, {
              id: yield* mintId(FeedEventId),
              origin: "money",
              category: "money_tax",
              eventType: "bank_statement_archived",
              severity: "info",
              summary: `${account.productLabel}: statement archived`,
              payload: { archiveId: inserted.id, accountId: account.id, digest },
              links: null,
            });
            return inserted;
          }

          return (yield* readArchive(sql, input.accountId, digest))!;
        }),
    );
  }).pipe(persistenceToBoundary);
