import {
  Conflict,
  ConfirmBankImportResult,
  Internal,
  NotFound,
  Stale,
  ValidationFailed,
  type AmbiguityResolution,
  type BankImportSource,
  type PreviewBankImportResult,
} from "@ironcage/contracts/schema";
import { monthOf, RequestId, Sha256 } from "@ironcage/domain";
import { Effect, Schema } from "effect";

import { runIdempotentMutation } from "../../persistence/app-requests";
import { persistenceToBoundary } from "../../persistence/error";
import { Postgres } from "../../persistence/postgres";
import { generateMonthlySpendingReports } from "../../reports/service";
import { bindAccountIdentity } from "../accounts/repository";
import { enqueueCategorizationBatches } from "../categorization/dispatch";
import { emitCoverageEvents, emitDerivedEvents } from "../feed/service";
import { detectOwnedTransfers } from "../transfers/service";
import { BankImportBlocked } from "./block";
import { sha256Hex } from "./bytes";
import { buildConfirmedImport } from "./confirmation";
import { prepareBankImport, toBankImportPreview } from "./prepare";
import type { ImportDependencies, StatementExtraction } from "./prepared-import";
import { insertConfirmedImport } from "./repository";

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

export interface ConfirmBankImportInput {
  readonly source: BankImportSource;
  readonly expectedBundleDigest: Sha256;
  readonly expectedPreviewFingerprint: Sha256;
  readonly resolutions: readonly AmbiguityResolution[];
  readonly requestId: RequestId;
}

const decodeSha = Schema.decodeUnknownSync(Sha256);
const confirmPayloadHash = (input: ConfirmBankImportInput): Promise<string> =>
  sha256Hex(
    new TextEncoder().encode(
      JSON.stringify({
        digest: input.expectedBundleDigest,
        fingerprint: input.expectedPreviewFingerprint,
        resolutions: input.resolutions,
      }),
    ),
  );

export const confirmBankImport = (
  input: ConfirmBankImportInput,
  deps: ImportDependencies,
): Effect.Effect<
  ConfirmBankImportResult,
  ValidationFailed | NotFound | Conflict | Stale | Internal,
  Postgres
> =>
  Effect.gen(function* () {
    const payloadHash = decodeSha(yield* Effect.promise(() => confirmPayloadHash(input)));
    let statementExtraction: Promise<StatementExtraction> | undefined;
    const preparedDeps: ImportDependencies = {
      ...deps,
      extractStatement: (pdf) => {
        statementExtraction ??= deps.extractStatement(pdf);
        return statementExtraction;
      },
    };
    const postgres = yield* Postgres;
    const preflight = yield* postgres.readTransaction((sql) =>
      prepareBankImport(sql, input.source, preparedDeps).pipe(
        Effect.catchIf(
          (error): error is BankImportBlocked => error instanceof BankImportBlocked,
          Effect.succeed,
        ),
      ),
    );

    if (
      !(preflight instanceof BankImportBlocked) &&
      preflight.digest !== input.expectedBundleDigest
    ) {
      return yield* Effect.fail(
        new Conflict({
          reason: "ImportBytesChanged",
          detail: "the uploaded bytes differ from the previewed bundle",
        }),
      );
    }

    return yield* runIdempotentMutation(
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

          const prepared = yield* prepareBankImport(sql, input.source, preparedDeps).pipe(
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
          yield* detectOwnedTransfers(
            sql,
            graph.transactions.map((transaction) => transaction.id),
          );
          yield* emitCoverageEvents(
            sql,
            prepared.account,
            prepared.coverage.gapsBefore,
            prepared.coverage.gapsRemaining,
          );
          yield* emitDerivedEvents(
            sql,
            new Set(graph.transactions.map((transaction) => monthOf(transaction.postedDate))),
          );
          yield* generateMonthlySpendingReports(sql);

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
  }).pipe(persistenceToBoundary);
