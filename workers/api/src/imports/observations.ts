import type { PgClient } from "@effect/sql-pg";
import {
  Candidate,
  ImportId,
  ObservationDecision,
  ObservationId,
  ParsedObservation,
  PostingId,
  SourceFileId,
} from "@repo/contracts/finance";
import { type Crypto, Effect, Schema } from "effect";

export const StoredObservation = Schema.Struct({
  id: ObservationId,
  ...ParsedObservation.fields,
  parsedCandidate: Schema.NullOr(Candidate),
  postingId: Schema.NullOr(PostingId),
  decision: Schema.NullOr(ObservationDecision),
});
export type StoredObservation = typeof StoredObservation.Type;

export const readObservations = (sql: PgClient.PgClient, sourceFileId: typeof SourceFileId.Type) =>
  sql`SELECT id, locator_key AS "locatorKey", locator, raw, candidate, parsed_candidate AS "parsedCandidate", issue, posting_id AS "postingId", decision FROM observations WHERE source_file_id = ${sourceFileId} ORDER BY CASE locator->>'kind' WHEN 'csvLine' THEN (locator->>'line')::integer WHEN 'ofxTransaction' THEN (locator->>'ordinal')::integer ELSE (locator->>'page')::integer END, (locator->>'row')::integer, locator_key`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(StoredObservation))),
  );

export const saveObservations = Effect.fn("saveObservations")(function* (
  sql: PgClient.PgClient,
  crypto: Crypto.Crypto,
  importId: typeof ImportId.Type,
  sourceFileId: typeof SourceFileId.Type,
  observations: ReadonlyArray<ParsedObservation>,
) {
  const rows = yield* Effect.forEach(
    observations,
    Effect.fn(function* (observation) {
      const encoded = yield* Schema.encodeEffect(ParsedObservation)(observation);
      return {
        id: yield* crypto.randomUUIDv4,
        import_id: importId,
        source_file_id: sourceFileId,
        locator_key: encoded.locatorKey,
        locator: encoded.locator,
        raw: encoded.raw,
        candidate: encoded.candidate,
        parsed_candidate: encoded.candidate,
        issue: encoded.issue,
      };
    }),
  );
  if (rows.length > 0)
    yield* sql`INSERT INTO observations ${sql.insert(rows)} ON CONFLICT (source_file_id, locator_key) DO UPDATE SET import_id = EXCLUDED.import_id, locator = EXCLUDED.locator, raw = EXCLUDED.raw, parsed_candidate = EXCLUDED.parsed_candidate, issue = EXCLUDED.issue, candidate = CASE WHEN observations.posting_id IS NULL THEN EXCLUDED.candidate ELSE observations.candidate END`;
});

export const effectiveCandidate = (row: StoredObservation) =>
  row.decision?.kind === "omit"
    ? null
    : row.decision && "candidate" in row.decision
      ? (row.decision.candidate ?? row.parsedCandidate)
      : row.parsedCandidate;
