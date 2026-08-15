import {
  Conflict,
  type ConfirmBankImportPayload,
  ConfirmBankImportResult,
  Internal,
  NotFound,
  Stale,
  ValidationFailed,
  type BankImportSource,
  type PreviewBankImportResult,
} from "@ironcage/contracts/schema";
import { BankImportId, monthOf, Sha256 } from "@ironcage/domain";
import { Effect, Schema } from "effect";

import { runIdempotentMutation } from "../../persistence/app-requests";
import { persistenceToBoundary } from "../../persistence/error";
import { Postgres, type SqlExecutor } from "../../persistence/postgres";
import { generateMonthlySpendingReports } from "../../reports";
import { bindAccountIdentity } from "../accounts/records";
import { analyzeMoney } from "../analysis";
import { enqueueCategorizationBatches } from "../categorization/dispatch";
import { emitCoverageEvents, emitDerivedEvents } from "../feed";
import { detectOwnedTransfers } from "../transfers";
import { BankImportBlocked } from "./block";
import { sha256Hex } from "./bytes";
import { buildConfirmedImport } from "./confirmation";
import { prepareBankImport, toBankImportPreview } from "./prepare";
import type { ImportDependencies } from "./prepared-import";
import { insertConfirmedImport, loadImportedTransactions } from "./store";

export { statementProfileName } from "./prepared-import";
export type { ImportDependencies as ImportDeps, StatementExtraction } from "./prepared-import";

export const previewBankImport = (
  source: BankImportSource,
  deps: ImportDependencies,
): Effect.Effect<PreviewBankImportResult, ValidationFailed | NotFound | Internal, Postgres> =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;
    return yield* postgres.readTransaction((sql) =>
      Effect.map(prepareBankImport(sql, source, deps), (prepared) => ({
        kind: "ready" as const,
        preview: toBankImportPreview(prepared),
      })).pipe(
        Effect.catchIf(
          (error): error is BankImportBlocked => error instanceof BankImportBlocked,
          (error) => Effect.succeed({ kind: "blocked" as const, block: error.block }),
        ),
      ),
    );
  }).pipe(persistenceToBoundary);

const decodeSha = Schema.decodeUnknownSync(Sha256);
const confirmPayloadHash = async (input: ConfirmBankImportPayload): Promise<string> => {
  const files =
    input.source.kind === "commbank_structured"
      ? [
          ["csv", await sha256Hex(input.source.csv.bytes)],
          ["ofx", await sha256Hex(input.source.ofx.bytes)],
        ]
      : [["pdf", await sha256Hex(input.source.pdf.bytes)]];

  return sha256Hex(
    new TextEncoder().encode(
      JSON.stringify({
        source: { kind: input.source.kind, accountId: input.source.accountId, files },
        digest: input.expectedBundleDigest,
        fingerprint: input.expectedPreviewFingerprint,
        resolutions: input.resolutions,
      }),
    ),
  );
};

const deriveConfirmedImport = Effect.fn("deriveConfirmedImport")(function* (
  sql: SqlExecutor,
  importId: BankImportId,
) {
  const imported = yield* loadImportedTransactions(sql, importId);
  yield* detectOwnedTransfers(
    sql,
    imported.map((transaction) => transaction.id),
  );
  const analysis = yield* analyzeMoney(sql);
  const touchedMonths = new Set(imported.map((transaction) => monthOf(transaction.postedDate)));
  yield* emitDerivedEvents(sql, touchedMonths, analysis);
  yield* generateMonthlySpendingReports(sql, analysis);
});

export const confirmBankImport = (
  input: ConfirmBankImportPayload,
  deps: ImportDependencies,
): Effect.Effect<
  ConfirmBankImportResult,
  ValidationFailed | NotFound | Conflict | Stale | Internal,
  Postgres
> =>
  Effect.gen(function* () {
    const payloadHash = decodeSha(yield* Effect.promise(() => confirmPayloadHash(input)));
    const postgres = yield* Postgres;
    const result = yield* runIdempotentMutation(
      {
        requestId: input.requestId,
        operation: "confirmBankImport",
        payloadHash,
        response: ConfirmBankImportResult,
      },
      (sql) =>
        Effect.gen(function* () {
          yield* sql.execute(
            "lock bank account for confirm",
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`bank-import:${input.source.accountId}`],
          );

          const prepared = yield* prepareBankImport(sql, input.source, deps).pipe(
            Effect.catchIf(
              (error): error is BankImportBlocked => error instanceof BankImportBlocked,
              Effect.succeed,
            ),
          );
          if (prepared instanceof BankImportBlocked) {
            return { kind: "blocked", block: prepared.block } as const;
          }
          if (prepared.digest !== input.expectedBundleDigest) {
            return yield* Effect.fail(
              new Conflict({
                reason: "ImportBytesChanged",
                detail: "the uploaded bytes differ from the previewed bundle",
              }),
            );
          }
          if (prepared.kind === "replay") {
            return {
              kind: "confirmed",
              importId: prepared.import.id,
              effects: prepared.import.effects,
              coverageAdded: [],
            } as const;
          }
          if (prepared.fingerprint !== input.expectedPreviewFingerprint) {
            return yield* Effect.fail(
              new Stale({
                reason: "PreviewStale",
                detail: "the record moved since preview; preview again",
              }),
            );
          }

          const graph = yield* buildConfirmedImport(prepared, input.resolutions);
          yield* insertConfirmedImport(sql, prepared.account, graph);
          yield* enqueueCategorizationBatches(sql, graph);
          yield* emitCoverageEvents(
            sql,
            prepared.account,
            prepared.coverage.gapsBefore,
            prepared.coverage.gapsRemaining,
          );
          if (prepared.account.identityHmac === null) {
            yield* bindAccountIdentity(
              sql,
              prepared.account.id,
              prepared.identityHmac,
              prepared.maskedSuffix,
            );
          }

          return {
            kind: "confirmed",
            importId: graph.importRow.id,
            effects: graph.importRow.effects,
            coverageAdded: prepared.coverage.added,
          } as const;
        }),
    );

    if (result.kind === "confirmed") {
      yield* postgres.transaction((sql) => deriveConfirmedImport(sql, result.importId));
    }
    return result;
  }).pipe(persistenceToBoundary);
