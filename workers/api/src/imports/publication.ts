import { PgClient } from "@effect/sql-pg";
import {
  AccountId,
  BankAccount,
  CommandId,
  FinanceError,
  ImportId,
  ImportSummary,
  PublishImport,
  SourceFileId,
  Statement,
} from "@repo/contracts/finance";
import { matchObservations, reconcile, type MatchingObservation } from "@repo/finance";
import { Context, Crypto, Effect, Layer, Schema } from "effect";
import { v5 } from "uuid";

import { AccountResolution } from "../accounts/resolution.ts";
import { Commands, databaseUnavailable, fingerprint } from "../database/commands.ts";
import { replaceQuestions, type PendingQuestion } from "../review/repository.ts";
import { applyAssignments, readMatchingPostings } from "./matching.ts";
import { effectiveCandidate, readObservations, saveObservations } from "./observations.ts";

const PublicationSource = Schema.Struct({
  sourceFileId: SourceFileId,
  accountId: Schema.NullOr(AccountId),
  status: Schema.String,
  statement: Statement,
  account: Schema.NullOr(BankAccount),
});
const questionMessages = {
  changedSource:
    "This reading differs from the accepted source row. Keep the accepted values or correct them explicitly.",
  changedBankId:
    "This bank transaction ID already supports a different value or another row in this file.",
  conflictingBalances: "The date and amount match, but the supplied running balances disagree.",
};

export class Publication extends Context.Service<
  Publication,
  {
    readonly publish: (
      input: typeof PublishImport.Type,
    ) => Effect.Effect<ImportSummary, FinanceError>;
    readonly republish: (
      importId: typeof ImportId.Type,
    ) => Effect.Effect<ImportSummary, FinanceError>;
  }
>()("@repo/api/imports/Publication") {
  static readonly layer = Layer.effect(
    Publication,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const commands = yield* Commands;
      const accounts = yield* AccountResolution;
      const crypto = yield* Crypto.Crypto;
      const runtime = Layer.mergeAll(
        Layer.succeed(PgClient.PgClient, sql),
        Layer.succeed(Crypto.Crypto, crypto),
      );
      const republish = Effect.fn("Publication.republish")(
        function* (importId: typeof ImportId.Type) {
          const sources =
            yield* sql`SELECT source_file_id AS "sourceFileId", account_id AS "accountId", status, statement, bank_account AS account FROM imports WHERE id = ${importId}`.pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(PublicationSource))),
            );
          const source = sources[0];
          if (!source)
            return yield* new FinanceError({ kind: "notFound", message: "Import not found." });
          const rows = yield* readObservations(source.sourceFileId);
          const questions: PendingQuestion[] = [];
          const account = yield* accounts
            .resolve({ accountId: source.accountId, identity: source.account })
            .pipe(
              Effect.catchTag("FinanceError", (error) => {
                if (error.kind !== "needsReview" && error.kind !== "conflict")
                  return Effect.fail(error);
                questions.push({
                  kind: "account",
                  question: {
                    reason: error.kind === "conflict" ? "accountConflict" : "accountMissing",
                    message: error.message,
                  },
                  observationIds: rows.map((row) => row.id),
                  postingIds: [],
                });
                return Effect.succeed(null);
              }),
            );

          if (account) {
            const active = rows.filter(
              (row) =>
                row.decision?.kind !== "omit" &&
                (effectiveCandidate(row) !== null || row.issue !== null),
            );
            const unreadable = active.filter((row) => effectiveCandidate(row) === null);
            for (const row of unreadable)
              questions.push({
                kind: "value",
                question: {
                  reason: "unreadableValue",
                  message: "Read the source beside this row and enter the booked values.",
                },
                observationIds: [row.id],
                postingIds: [],
              });
            const observations = active.map((row) => ({
              ...row,
              candidate: effectiveCandidate(row),
            }));
            const coverage = reconcile({ observations, statement: source.statement });
            const invalidCurrency = observations.some(
              (row) => row.candidate && row.candidate.amount.currency !== account.currency,
            );
            if (invalidCurrency)
              return yield* new FinanceError({
                kind: "invalid",
                message: "Every booked amount must use the account currency.",
              });
            if (coverage.issues.length > 0 && unreadable.length === 0) {
              questions.push({
                kind: "value",
                question: { reason: "unreconciled", message: coverage.issues.join(" ") },
                observationIds: active.map((row) => row.id),
                postingIds: active.flatMap((row) => (row.postingId ? [row.postingId] : [])),
              });
            } else {
              const postings = yield* readMatchingPostings(account.id);
              const byId = new Map(postings.map((posting) => [posting.id, posting]));
              const matchingRows: MatchingObservation[] = [];
              for (const row of active) {
                const candidate = effectiveCandidate(row);
                if (!candidate) continue;
                const choice = row.decision;
                const postingId =
                  choice?.kind === "match" || choice?.kind === "keep" || choice?.kind === "correct"
                    ? choice.postingId
                    : null;
                const posting = postingId ? byId.get(postingId) : undefined;
                matchingRows.push({
                  id: row.id,
                  locatorKey: row.locatorKey,
                  candidate,
                  decision: posting
                    ? { kind: "match", posting }
                    : choice?.kind === "distinct" || choice?.kind === "correct"
                      ? { kind: "distinct" }
                      : null,
                });
              }
              const result = matchObservations(
                source.sourceFileId,
                matchingRows,
                postings,
                source.statement.order,
                unreadable.length === 0,
              );
              for (const question of result.questions)
                questions.push({
                  kind: question.kind,
                  question: {
                    reason: question.reason,
                    message:
                      question.reason === "ambiguousGroup"
                        ? `${question.observationIds.length} source rows and ${question.postingIds.length} existing transactions share a booked date and amount. Their descriptions and running balances do not establish a unique pairing.`
                        : questionMessages[question.reason],
                  },
                  observationIds: question.observationIds,
                  postingIds: question.postingIds,
                });
              yield* applyAssignments(account.id, rows, result.assignments);
            }
            if (coverage.observedStart && coverage.observedEnd) {
              const id = yield* crypto.randomUUIDv4;
              yield* sql`INSERT INTO source_coverage ${sql.insert({ id, source_file_id: source.sourceFileId, account_id: account.id, stated_start: source.statement.statedStart, stated_end: source.statement.statedEnd, observed_start: coverage.observedStart, observed_end: coverage.observedEnd, opening_minor: coverage.opening?.money.minor ?? null, opening_on: coverage.opening?.on ?? null, closing_minor: coverage.closing?.money.minor ?? null, closing_on: coverage.closing?.on ?? null, reconciled: unreadable.length === 0 && coverage.reconciled })} ON CONFLICT (source_file_id, account_id) DO UPDATE SET stated_start = EXCLUDED.stated_start, stated_end = EXCLUDED.stated_end, observed_start = EXCLUDED.observed_start, observed_end = EXCLUDED.observed_end, opening_minor = EXCLUDED.opening_minor, opening_on = EXCLUDED.opening_on, closing_minor = EXCLUDED.closing_minor, closing_on = EXCLUDED.closing_on, reconciled = EXCLUDED.reconciled`;
            }
          }
          yield* replaceQuestions(importId, questions);
          const [counts] =
            yield* sql`SELECT count(*) FILTER (WHERE posting_id IS NOT NULL AND COALESCE((match_evidence->>'created')::boolean, match_method = 'new'))::integer AS "newPostings", count(*) FILTER (WHERE posting_id IS NOT NULL AND NOT COALESCE((match_evidence->>'created')::boolean, match_method = 'new'))::integer AS "matchedPostings" FROM observations WHERE source_file_id = ${source.sourceFileId}`.pipe(
              Effect.flatMap(
                Schema.decodeUnknownEffect(
                  Schema.Tuple([
                    Schema.Struct({ newPostings: Schema.Int, matchedPostings: Schema.Int }),
                  ]),
                ),
              ),
            );
          let summary: ImportSummary = {
            observations: rows.length,
            ...counts,
            reviewItems: questions.length,
          };
          if (source.statement.pages)
            summary = {
              ...summary,
              pages: {
                count: source.statement.pages.count,
                decoded: source.statement.pages.decoded,
                needingReview: [
                  ...new Set(
                    rows
                      .filter(
                        (row) =>
                          row.issue && row.decision?.kind !== "omit" && !effectiveCandidate(row),
                      )
                      .flatMap((row) => (row.locator.kind === "pdfRow" ? [row.locator.page] : [])),
                  ),
                ],
              },
            };
          yield* sql`UPDATE imports SET account_id = ${account?.id ?? source.accountId}, status = ${questions.length > 0 ? "needs_review" : "complete"}, summary = ${sql.json(summary)}, failure = NULL, version = version + 1, updated_at = now() WHERE id = ${importId}`;
          return summary;
        },
        Effect.provide(runtime),
        Effect.catchTags({
          SqlError: () => Effect.fail(databaseUnavailable()),
          SchemaError: () => Effect.fail(databaseUnavailable()),
          PlatformError: () => Effect.fail(databaseUnavailable()),
        }),
      );
      const publish = Effect.fn("Publication.publish")(function* (
        input: typeof PublishImport.Type,
      ) {
        const encoded = yield* Schema.encodeEffect(PublishImport)(input).pipe(
          Effect.mapError(databaseUnavailable),
        );
        const hash = yield* fingerprint(encoded).pipe(
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.mapError(databaseUnavailable),
        );
        return yield* commands.run({
          commandId: CommandId.make(v5(`${input.importId}/${input.parserVersion}/${hash}`, v5.URL)),
          input: encoded,
          result: Schema.toCodecJson(ImportSummary),
          execute: Effect.gen(function* () {
            const sources =
              yield* sql`UPDATE imports SET parser_version = ${input.parserVersion}, statement = ${sql.json(encoded.statement)}, bank_account = ${sql.json(encoded.account)} WHERE id = ${input.importId} RETURNING source_file_id AS "sourceFileId"`.pipe(
                Effect.flatMap(
                  Schema.decodeUnknownEffect(
                    Schema.Array(Schema.Struct({ sourceFileId: SourceFileId })),
                  ),
                ),
              );
            const source = sources[0];
            if (!source)
              return yield* new FinanceError({ kind: "notFound", message: "Import not found." });
            yield* saveObservations(input.importId, source.sourceFileId, input.observations);
            return yield* republish(input.importId);
          }).pipe(
            Effect.provide(runtime),
            Effect.catchTag("PlatformError", () => Effect.fail(databaseUnavailable())),
          ),
        });
      });
      return Publication.of({ publish, republish });
    }),
  );
}
