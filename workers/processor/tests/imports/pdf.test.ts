import { readFileSync } from "node:fs";
import { URL } from "node:url";

import { expect, it } from "@effect/vitest";
import { reconcile } from "@repo/finance";
import { Effect } from "effect";

import { parsePdf } from "../../src/imports/pdf/index.ts";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../fixtures/${name}.pdf`, import.meta.url)));

it.effect(
  "a malformed printed period fails instead of discarding the statement's balance anchors",
  () =>
    Effect.gen(function* () {
      const error = yield* parsePdf(fixture("card-invalid-period")).pipe(Effect.flip);
      expect(error).toMatchObject({
        kind: "invalid",
        message: "The statement metadata could not be decoded.",
      });
    }),
);

it.effect(
  "card decimal gaps, repayments, year boundaries and waived fees preserve their booked meaning",
  () =>
    Effect.gen(function* () {
      const result = yield* parsePdf(fixture("card"));
      expect(
        result.observations.flatMap((row) =>
          row.candidate ? [{ on: row.candidate.postedOn, minor: row.candidate.amount.minor }] : [],
        ),
      ).toEqual([
        { on: "2025-12-31", minor: -1250n },
        { on: "2026-01-02", minor: 5000n },
      ]);
      expect(result.observations[0]?.raw.debit).toBe("12 50");
      expect(result.observations[0]?.locator).toMatchObject({ kind: "pdfRow", page: 2, row: 1 });
      expect(result.observations[2]?.candidate).toBeNull();
      expect(result.observations[2]?.issue).toBeNull();
      expect(reconcile(result).reconciled).toBe(true);
      expect(result.statement.closing?.money.minor).toBe(-6250n);
    }),
);
it.effect(
  "deposit columns preserve large debits and a merchant name beginning with four digits",
  () =>
    Effect.gen(function* () {
      const result = yield* parsePdf(fixture("deposit"));
      expect(result.observations.map((row) => row.candidate?.amount.minor)).toEqual([
        -1250n,
        -1000000n,
      ]);
      expect(result.observations[0]?.candidate).toMatchObject({
        postedOn: "2026-08-02",
        description: "2024 Books",
      });
      expect(result.statement.debitTotal?.minor).toBe(1001250n);
      expect(reconcile(result).reconciled).toBe(true);
    }),
);
it.effect("loan balances use asset-positive signs and rate notices create no posting", () =>
  Effect.gen(function* () {
    const result = yield* parsePdf(fixture("loan"));
    expect(result.observations.map((row) => row.candidate?.amount.minor ?? null)).toEqual([
      -1000n,
      10000n,
      null,
    ]);
    expect(result.observations[2]?.issue).toBeNull();
    expect(result.statement.opening?.money.minor).toBe(-100000n);
    expect(result.statement.closing?.money.minor).toBe(-91000n);
    expect(reconcile(result).reconciled).toBe(true);
  }),
);
it.effect(
  "an unreadable page leaves readable pages available for publication and keeps its page locator",
  () =>
    Effect.gen(function* () {
      const result = yield* parsePdf(fixture("card-unreadable"));
      expect(result.observations.filter((row) => row.candidate)).toHaveLength(2);
      expect(result.observations.at(-1)).toMatchObject({
        locator: { kind: "pdfRow", page: 3, row: 1 },
        candidate: null,
        issue: { code: "unsupportedLayout" },
      });
      expect(result.statement.pages).toEqual({ count: 3, decoded: 2, needingReview: [3] });
    }),
);
