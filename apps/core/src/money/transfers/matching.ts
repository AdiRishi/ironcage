import {
  NotFound,
  TransferMatchSummary,
  ValidationFailed,
  type TransferCandidateGroup,
  type TransferLeg,
} from "@ironcage/contracts/schema";
import {
  Aud,
  BankAccountId,
  BankTransactionId,
  CalendarDate,
  TransferMatchId,
  TransferMatchMethod,
  TransferMatchStatus,
  type RequestId,
  type Sha256,
} from "@ironcage/domain";
import { Effect, Schema } from "effect";

import { mintId } from "../../ids";
import { runIdempotentMutation } from "../../persistence/app-requests";
import { persistenceToBoundary } from "../../persistence/error";
import { Postgres, type SqlExecutor } from "../../persistence/postgres";

/** Candidate legs must post within this many calendar days of each other. */
const transferWindowDays = 3;

const LegRow = Schema.Struct({
  transactionId: BankTransactionId,
  accountId: BankAccountId,
  productLabel: Schema.String,
  postedDate: CalendarDate,
  amount: Aud,
  narrative: Schema.String,
});

const PairRow = Schema.Struct({ aId: BankTransactionId, bId: BankTransactionId });

/**
 * Every open candidate pairing in the record: opposite signs across different
 * owned accounts, exactly equal absolute amounts, within the window, with
 * neither leg already in a confirmed match and the pair not dismissed. The
 * debit leg is `a`, so each pairing appears once.
 */
const openPairs = (sql: SqlExecutor) =>
  Effect.gen(function* () {
    return yield* sql.rows(
      "load open transfer pairs",
      PairRow,
      `SELECT t.id AS "aId", o.id AS "bId"
         FROM bank_transactions t
         JOIN bank_transactions o
           ON o.account_id <> t.account_id
          AND o.amount = -t.amount
          AND abs(o.posted_date - t.posted_date) <= ${transferWindowDays}
        WHERE t.amount < 0
          AND NOT EXISTS (SELECT 1 FROM transfer_matches m
                           WHERE m.status = 'confirmed'
                             AND (m.transaction_a IN (t.id, o.id) OR m.transaction_b IN (t.id, o.id)))
          AND NOT EXISTS (SELECT 1 FROM transfer_matches m
                           WHERE m.status = 'dismissed'
                             AND ((m.transaction_a = t.id AND m.transaction_b = o.id)
                               OR (m.transaction_a = o.id AND m.transaction_b = t.id)))
        ORDER BY t.posted_date, t.id`,
    );
  });

const loadLegs = (sql: SqlExecutor, ids: readonly BankTransactionId[]) =>
  Effect.gen(function* () {
    if (ids.length === 0) return new Map<BankTransactionId, TransferLeg>();
    const legs = yield* sql.rows(
      "load transfer legs",
      LegRow,
      `SELECT t.id AS "transactionId", t.account_id AS "accountId", a.product_label AS "productLabel",
              t.posted_date AS "postedDate", t.amount::text AS amount, t.display_narrative AS narrative
         FROM bank_transactions t JOIN bank_accounts a ON a.id = t.account_id
        WHERE t.id = ANY($1::uuid[])`,
      [[...ids]],
    );
    return new Map(legs.map((leg) => [leg.transactionId, leg]));
  });

const referenceTokens = (narrative: string): ReadonlySet<string> =>
  new Set(narrative.split(/\s+/).filter((token) => (token.match(/\d/g)?.length ?? 0) >= 6));

const sharesReference = (a: TransferLeg, b: TransferLeg): boolean => {
  const tokens = referenceTokens(a.narrative);
  for (const token of referenceTokens(b.narrative)) {
    if (tokens.has(token)) return true;
  }
  return false;
};

const insertMatch = (
  sql: SqlExecutor,
  input: {
    readonly a: BankTransactionId;
    readonly b: BankTransactionId;
    readonly status: TransferMatchStatus;
    readonly method: TransferMatchMethod;
    readonly provenance: unknown;
  },
) =>
  Effect.gen(function* () {
    const id = yield* mintId(TransferMatchId);
    yield* sql.execute(
      "insert transfer match",
      `INSERT INTO transfer_matches (id, transaction_a, transaction_b, status, method, provenance, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())`,
      [id, input.a, input.b, input.status, input.method, JSON.stringify(input.provenance)],
    );
    return id;
  });

/**
 * Auto-confirms the unambiguous pairings after a confirmed import: a pair
 * whose legs have no other possibility, or whose narratives share a
 * normalized bank reference no competing pair shares. Everything else waits
 * for the operator.
 */
export const detectOwnedTransfers = Effect.fn("detectOwnedTransfers")(function* (
  sql: SqlExecutor,
  scope: readonly BankTransactionId[],
) {
  if (scope.length === 0) return 0;
  const scoped = new Set(scope);
  const all = yield* openPairs(sql);
  const pairs = all.filter((pair) => scoped.has(pair.aId) || scoped.has(pair.bId));
  const legs = yield* loadLegs(sql, [...new Set(all.flatMap((pair) => [pair.aId, pair.bId]))]);

  const degree = new Map<BankTransactionId, number>();
  for (const pair of all) {
    degree.set(pair.aId, (degree.get(pair.aId) ?? 0) + 1);
    degree.set(pair.bId, (degree.get(pair.bId) ?? 0) + 1);
  }

  const claimed = new Set<BankTransactionId>();
  let confirmed = 0;

  for (const pair of pairs) {
    if (claimed.has(pair.aId) || claimed.has(pair.bId)) continue;
    const a = legs.get(pair.aId);
    const b = legs.get(pair.bId);
    if (a === undefined || b === undefined) continue;

    const sole = degree.get(pair.aId) === 1 && degree.get(pair.bId) === 1;
    // A reference match is decisive only when no competing pairing over
    // either leg also carries an agreeing reference.
    const referenced =
      sharesReference(a, b) &&
      !all.some((other) => {
        if (other.aId === pair.aId && other.bId === pair.bId) return false;
        const competes =
          other.aId === pair.aId ||
          other.bId === pair.bId ||
          other.aId === pair.bId ||
          other.bId === pair.aId;
        return competes && sharesReference(legs.get(other.aId)!, legs.get(other.bId)!);
      });

    if (!sole && !referenced) continue;

    yield* insertMatch(sql, {
      a: pair.aId,
      b: pair.bId,
      status: "confirmed",
      method: sole ? "sole_pairing" : "reference",
      provenance: { detectedBy: sole ? "sole_pairing" : "reference" },
    });
    claimed.add(pair.aId);
    claimed.add(pair.bId);
    confirmed += 1;
  }

  return confirmed;
});

const MatchRow = Schema.Struct({
  id: TransferMatchId,
  aId: BankTransactionId,
  bId: BankTransactionId,
  status: TransferMatchStatus,
  method: TransferMatchMethod,
  createdAt: Schema.DateTimeUtcFromDate,
});

export const getTransferMatches = Effect.fn("getTransferMatches")(function* () {
  const postgres = yield* Postgres;

  return yield* postgres.readTransaction((sql) =>
    Effect.gen(function* () {
      const matches = yield* sql.rows(
        "list transfer matches",
        MatchRow,
        `SELECT id, transaction_a AS "aId", transaction_b AS "bId", status, method, created_at AS "createdAt"
             FROM transfer_matches ORDER BY created_at DESC LIMIT 500`,
      );
      const pairs = yield* openPairs(sql);
      const legIds = [
        ...new Set([
          ...matches.flatMap((match) => [match.aId, match.bId]),
          ...pairs.flatMap((pair) => [pair.aId, pair.bId]),
        ]),
      ];
      const legs = yield* loadLegs(sql, legIds);

      const unresolvedByLeg = new Map<BankTransactionId, TransferLeg[]>();
      for (const pair of pairs) {
        const list = unresolvedByLeg.get(pair.aId);
        const counterpart = legs.get(pair.bId)!;
        if (list === undefined) unresolvedByLeg.set(pair.aId, [counterpart]);
        else list.push(counterpart);
      }

      const unresolved: TransferCandidateGroup[] = [...unresolvedByLeg.entries()].map(
        ([id, counterparts]) => ({ transaction: legs.get(id)!, counterparts }),
      );

      return {
        matches: matches.map((match) => ({
          id: match.id,
          a: legs.get(match.aId)!,
          b: legs.get(match.bId)!,
          status: match.status,
          method: match.method,
          createdAt: match.createdAt,
        })),
        unresolved,
      };
    }),
  );
}, persistenceToBoundary);

export const decideTransferMatch = (input: {
  readonly requestId: RequestId;
  readonly payloadHash: Sha256;
  readonly transactionA: BankTransactionId;
  readonly transactionB: BankTransactionId;
  readonly decision: "confirm" | "dismiss";
}) =>
  runIdempotentMutation(
    {
      requestId: input.requestId,
      operation: "decideTransferMatch",
      payloadHash: input.payloadHash,
      response: TransferMatchSummary,
    },
    (sql) =>
      Effect.gen(function* () {
        const pairs = yield* openPairs(sql);
        const pair = pairs.find(
          (candidate) =>
            (candidate.aId === input.transactionA && candidate.bId === input.transactionB) ||
            (candidate.aId === input.transactionB && candidate.bId === input.transactionA),
        );
        if (pair === undefined) {
          return yield* Effect.fail(
            new ValidationFailed({
              reason: "NotATransferCandidate",
              detail: "the two transactions are not an open opposite-legged pairing",
            }),
          );
        }

        const id = yield* insertMatch(sql, {
          a: pair.aId,
          b: pair.bId,
          status: input.decision === "confirm" ? "confirmed" : "dismissed",
          method: "operator",
          provenance: { decidedBy: "operator" },
        });

        const rows = yield* sql.rows(
          "read transfer match",
          MatchRow,
          `SELECT id, transaction_a AS "aId", transaction_b AS "bId", status, method, created_at AS "createdAt"
             FROM transfer_matches WHERE id = $1`,
          [id],
        );
        const match = rows[0];
        const legs = yield* loadLegs(sql, [pair.aId, pair.bId]);
        const a = legs.get(pair.aId);
        const b = legs.get(pair.bId);
        if (match === undefined || a === undefined || b === undefined) {
          return yield* Effect.fail(
            new NotFound({ entity: "bank transaction", id: input.transactionA }),
          );
        }

        return {
          id: match.id,
          a,
          b,
          status: match.status,
          method: match.method,
          createdAt: match.createdAt,
        };
      }),
  );
