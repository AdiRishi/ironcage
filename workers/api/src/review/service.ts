import { PgClient } from "@effect/sql-pg";
import {
  AccountId,
  Candidate,
  SourceFileId,
  FinanceError,
  ImportSummary,
  ObservationDecision,
  PostingId,
  ResolveReview,
  ReviewItem,
} from "@repo/contracts/finance";
import { Context, Effect, Layer, Schema } from "effect";

import { Commands, databaseUnavailable } from "../database/commands.ts";
import { readMatchingPostings } from "../imports/matching.ts";
import { effectiveCandidate, readObservations } from "../imports/observations.ts";
import { Publication } from "../imports/publication.ts";
import { readReviews } from "./repository.ts";

const invalid = (message: string) => new FinanceError({ kind: "invalid", message });
export class Reviews extends Context.Service<
  Reviews,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<ReviewItem>, FinanceError>;
    readonly resolve: (
      input: typeof ResolveReview.Type,
    ) => Effect.Effect<ImportSummary, FinanceError>;
  }
>()("@repo/api/review/Reviews") {
  static readonly layer = Layer.effect(
    Reviews,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const commands = yield* Commands;
      const publication = yield* Publication;
      const list = Effect.fn("Reviews.list")(() =>
        readReviews().pipe(
          Effect.provideService(PgClient.PgClient, sql),
          Effect.mapError(databaseUnavailable),
        ),
      );
      const resolve = Effect.fn("Reviews.resolve")(function* (input: typeof ResolveReview.Type) {
        const encoded = yield* Schema.encodeEffect(ResolveReview)(input).pipe(
          Effect.mapError(databaseUnavailable),
        );
        return yield* commands.run({
          commandId: input.commandId,
          input: encoded,
          result: Schema.toCodecJson(ImportSummary),
          execute: Effect.gen(function* () {
            const reviews = yield* readReviews();
            const review = reviews.find((item) => item.id === input.reviewItemId);
            if (!review)
              return yield* new FinanceError({
                kind: "stale",
                message: "This review has changed or was resolved. Refresh the review list.",
              });
            if (review.version !== input.expectedVersion)
              return yield* new FinanceError({
                kind: "stale",
                message: "This review has changed. Refresh it before choosing an answer.",
              });
            const resolution = input.resolution;
            if (resolution.kind === "account") {
              if (review.kind !== "account")
                return yield* invalid("This review does not ask for an account.");
              yield* sql`UPDATE imports SET account_id = ${resolution.accountId} WHERE id = ${review.importId}`;
            } else {
              if (review.kind === "account")
                return yield* invalid("Choose the account for this import first.");
              const sources =
                yield* sql`SELECT source_file_id AS "sourceFileId", account_id AS "accountId" FROM imports WHERE id = ${review.importId}`.pipe(
                  Effect.flatMap(
                    Schema.decodeUnknownEffect(
                      Schema.Array(
                        Schema.Struct({ sourceFileId: SourceFileId, accountId: AccountId }),
                      ),
                    ),
                  ),
                );
              const source = sources[0];
              if (!source)
                return yield* invalid(
                  "The import needs an account before its rows can be reviewed.",
                );
              const rows = yield* readObservations(source.sourceFileId);
              const postings = yield* readMatchingPostings(source.accountId);
              const allowedRows = new Set(review.observations.map((row) => row.id));
              const chosenRows = new Set(resolution.decisions.map((item) => item.observationId));
              if (
                chosenRows.size !== resolution.decisions.length ||
                [...chosenRows].some((id) => !allowedRows.has(id))
              )
                return yield* invalid(
                  "Choose each source row at most once, using only rows in this review.",
                );
              const claims = new Set<typeof PostingId.Type>();
              for (const row of rows)
                if (row.postingId && !chosenRows.has(row.id)) claims.add(row.postingId);
              for (const answer of resolution.decisions) {
                const row = rows.find((item) => item.id === answer.observationId);
                if (!row) return yield* invalid("Source row not found.");
                const decision = answer.decision;
                if (decision.kind === "omit" && row.postingId)
                  return yield* invalid("An accepted source row must be kept or corrected.");
                if (decision.kind === "distinct" && row.postingId)
                  return yield* invalid(
                    "This row already supports a transaction. Keep or correct its accepted values.",
                  );
                if (
                  decision.kind === "keep" &&
                  (!row.candidate ||
                    !row.postingId ||
                    decision.postingId !== row.postingId ||
                    !Schema.toEquivalence(Candidate)(decision.candidate, row.candidate))
                )
                  return yield* invalid(
                    "Keep must use this row's accepted values and transaction.",
                  );
                const candidate =
                  decision.kind === "correct" || decision.kind === "keep"
                    ? decision.candidate
                    : effectiveCandidate(row);
                const postingId =
                  decision.kind === "match" ||
                  decision.kind === "correct" ||
                  decision.kind === "keep"
                    ? decision.postingId
                    : null;
                if (decision.kind !== "omit" && !candidate)
                  return yield* invalid("Enter the booked values before matching this row.");
                if (postingId) {
                  const posting = postings.find((item) => item.id === postingId);
                  if (
                    !posting ||
                    (!review.candidates.some((item) => item.id === postingId) &&
                      row.postingId !== postingId)
                  )
                    return yield* invalid("Choose one of the transactions offered by this review.");
                  if (claims.has(postingId))
                    return yield* invalid("A file can support each transaction only once.");
                  if (
                    decision.kind === "match" &&
                    candidate &&
                    (candidate.postedOn !== posting.candidate.postedOn ||
                      candidate.amount.currency !== posting.candidate.amount.currency ||
                      candidate.amount.minor !== posting.candidate.amount.minor)
                  )
                    return yield* invalid(
                      "A match must have the same booked date, currency and amount. Correct the value first if needed.",
                    );
                  claims.add(postingId);
                } else if (row.postingId && decision.kind === "correct")
                  return yield* invalid(
                    "Correct the existing transaction for an accepted source row.",
                  );
                const stored = yield* Schema.encodeEffect(ObservationDecision)(decision);
                yield* sql`UPDATE observations SET decision = ${sql.json(stored)} WHERE id = ${answer.observationId}`;
              }
            }
            yield* sql`UPDATE review_items SET resolution = ${sql.json(encoded.resolution)}, resolved_at = now(), version = version + 1 WHERE id = ${input.reviewItemId}`;
            return yield* publication.republish(review.importId);
          }).pipe(Effect.provideService(PgClient.PgClient, sql)),
        });
      });
      return Reviews.of({ list, resolve });
    }),
  );
}
