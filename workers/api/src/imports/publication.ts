import { PgClient } from "@effect/sql-pg";
import {
  AccountId,
  CommandId,
  FinanceError,
  ImportSummary,
  ParsedObservation,
  PublishImport,
} from "@repo/contracts/finance";
import { reconcile } from "@repo/finance";
import { Context, Crypto, Effect, Layer, Schema } from "effect";
import { v5 } from "uuid";

import { AccountResolution } from "../accounts/resolution.ts";
import { Commands, databaseUnavailable, fingerprint } from "../database/commands.ts";

const PublicationSource = Schema.Struct({
  sourceFileId: Schema.String,
  accountId: Schema.NullOr(AccountId),
  status: Schema.String,
});
export class Publication extends Context.Service<
  Publication,
  {
    readonly publish: (
      input: typeof PublishImport.Type,
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
        const commandId = CommandId.make(
          v5(`${input.importId}/${input.parserVersion}/${hash}`, v5.URL),
        );
        return yield* commands.run({
          commandId,
          input: encoded,
          result: Schema.toCodecJson(ImportSummary),
          execute: Effect.gen(function* () {
            const sources =
              yield* sql`SELECT source_file_id AS "sourceFileId", account_id AS "accountId", status FROM imports WHERE id = ${input.importId}`.pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(PublicationSource))),
              );
            const source = sources[0];
            if (!source)
              return yield* new FinanceError({ kind: "notFound", message: "Import not found." });
            if (source.status !== "processing")
              return yield* new FinanceError({
                kind: "conflict",
                message: "This import is not processing.",
              });
            const account = yield* accounts.resolve({
              accountId: source.accountId,
              identity: input.account,
            });
            const coverage = reconcile(input);
            if (coverage.issues.length > 0)
              return yield* new FinanceError({
                kind: "needsReview",
                message: coverage.issues.join(" "),
              });
            const rows = yield* Effect.forEach(
              input.observations,
              Effect.fn(function* (observation) {
                if (!observation.candidate)
                  return yield* new FinanceError({
                    kind: "invalid",
                    message: "The source contains an unreadable row.",
                  });
                const candidate = observation.candidate;
                const postingId = yield* crypto.randomUUIDv4.pipe(
                  Effect.mapError(databaseUnavailable),
                );
                const observationId = yield* crypto.randomUUIDv4.pipe(
                  Effect.mapError(databaseUnavailable),
                );
                const stored = yield* Schema.encodeEffect(ParsedObservation)(observation);
                return {
                  posting: {
                    id: postingId,
                    account_id: account.id,
                    currency: candidate.amount.currency,
                    amount_minor: candidate.amount.minor,
                    posted_on: candidate.postedOn,
                    value_on: candidate.valueOn,
                    description: candidate.description,
                    original_currency: candidate.originalMoney?.currency ?? null,
                    original_amount_minor: candidate.originalMoney?.minor ?? null,
                  },
                  observation: {
                    id: observationId,
                    import_id: input.importId,
                    source_file_id: source.sourceFileId,
                    locator_key: observation.locatorKey,
                    locator: stored.locator,
                    raw: stored.raw,
                    candidate: stored.candidate,
                    issue: null,
                    posting_id: postingId,
                    match_method: "new",
                    match_evidence: {},
                  },
                };
              }),
            );
            if (rows.length > 0) {
              yield* sql`INSERT INTO postings ${sql.insert(rows.map((row) => row.posting))}`;
              yield* sql`INSERT INTO observations ${sql.insert(rows.map((row) => row.observation))}`;
            }
            if (coverage.observedStart && coverage.observedEnd) {
              const id = yield* crypto.randomUUIDv4.pipe(Effect.mapError(databaseUnavailable));
              yield* sql`INSERT INTO source_coverage ${sql.insert({
                id,
                source_file_id: source.sourceFileId,
                account_id: account.id,
                stated_start: input.statement.statedStart,
                stated_end: input.statement.statedEnd,
                observed_start: coverage.observedStart,
                observed_end: coverage.observedEnd,
                opening_minor: coverage.opening?.money.minor ?? null,
                opening_on: coverage.opening?.on ?? null,
                closing_minor: coverage.closing?.money.minor ?? null,
                closing_on: coverage.closing?.on ?? null,
                reconciled: coverage.reconciled,
              })}`;
            }
            const summary = {
              observations: rows.length,
              newPostings: rows.length,
              matchedPostings: 0,
              reviewItems: 0,
            };
            yield* sql`UPDATE imports SET account_id = ${account.id}, statement = ${sql.json(encoded.statement)}, bank_account = ${sql.json(encoded.account)}, status = 'complete', summary = ${sql.json(summary)}, parser_version = ${input.parserVersion}, failure = NULL, version = version + 1, updated_at = now() WHERE id = ${input.importId}`;
            return summary;
          }),
        });
      });
      return Publication.of({ publish });
    }),
  );
}
