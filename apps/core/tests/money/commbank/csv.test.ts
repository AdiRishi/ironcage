import { it } from "@effect/vitest";
import { BigDecimal, Effect, Option } from "effect";
import { describe, expect } from "vitest";

import { CommBankCsvRejected, decodeCommBankCsv } from "../../../src/money/commbank/csv";
import type { CommBankAccountProfileId } from "../../../src/money/commbank/profiles";
import homeLoanA from "../../fixtures/money/commbank/home-loan/home-loan-a.csv?bytes";
import mastercardA from "../../fixtures/money/commbank/mastercard/mastercard-a.csv?bytes";
import savingsA from "../../fixtures/money/commbank/savings-offset/savings-offset-a.csv?bytes";
import spendingA from "../../fixtures/money/commbank/spending-offset/spending-offset-a.csv?bytes";
import spendingB from "../../fixtures/money/commbank/spending-offset/spending-offset-b.csv?bytes";
import spendingC from "../../fixtures/money/commbank/spending-offset/spending-offset-c.csv?bytes";

/** Independently reviewed row counts from the source exports. */
const corpus = [
  { id: "spending-offset-a", profile: "spending-offset", bytes: spendingA, rows: 40 },
  { id: "spending-offset-b", profile: "spending-offset", bytes: spendingB, rows: 25 },
  { id: "spending-offset-c", profile: "spending-offset", bytes: spendingC, rows: 23 },
  { id: "savings-offset-a", profile: "savings-offset", bytes: savingsA, rows: 40 },
  { id: "mastercard-a", profile: "mastercard", bytes: mastercardA, rows: 102 },
  { id: "home-loan-a", profile: "home-loan", bytes: homeLoanA, rows: 36 },
] as const;

const synthetic = (...lines: readonly string[]) =>
  new TextEncoder().encode(lines.map((line) => `${line}\r\n`).join(""));

const spendingRow = '29/01/2032,"-64.17","FIXTURE SPENDING OFFSET TRANSACTION 0040","6508.36"';

describe("the observed corpus", () => {
  for (const { id, profile, bytes, rows } of corpus) {
    it.effect(`${id} decodes to its reviewed row count`, () =>
      Effect.gen(function* () {
        const file = yield* decodeCommBankCsv(bytes, profile);

        expect(file.accountProfile).toBe(profile);
        expect(file.rows).toHaveLength(rows);
        expect(file.rows.map((row) => row.sourceOrdinal)).toEqual([...Array(rows).keys()]);
      }),
    );
  }

  it.effect("keeps every cell exactly as the file wrote it", () =>
    Effect.gen(function* () {
      const file = yield* decodeCommBankCsv(spendingA, "spending-offset");

      expect(file.rows.at(0)?.raw).toEqual({
        date: "08/08/2026",
        amount: "-6.20",
        narrative: "TFNSW OPAL FARE SYDNEY AUS Card xx0000 Value Date: 06/08/2026",
        balance: "+21561.27",
      });
      expect(file.rows.at(-1)?.raw).toEqual({
        date: "20/06/2026",
        amount: "-0.93",
        narrative: "International Transaction Fee Value Date: 18/06/2026",
        balance: "+24298.49",
      });
    }),
  );

  it.effect("reads rows newest first, which is the order the export writes", () =>
    Effect.gen(function* () {
      const file = yield* decodeCommBankCsv(savingsA, "savings-offset");
      const dates = file.rows.map((row) => row.postedDate);

      expect(dates.at(0)).toBe("2026-03-26");
      expect(dates.at(-1)).toBe("2024-12-03");
      expect([...dates].sort().reverse()).toEqual(dates);
    }),
  );

  it.effect("parses a signed amount as a decimal, never as a number", () =>
    Effect.gen(function* () {
      const file = yield* decodeCommBankCsv(savingsA, "savings-offset");
      const first = file.rows[0];

      expect(first).toBeDefined();
      if (first === undefined) return;

      expect(BigDecimal.format(first.amount)).toBe("13025.95");
      expect(BigDecimal.format(Option.getOrThrow(first.rowBalance))).toBe("54255.52");
    }),
  );

  it.effect("carries the home loan's negative running balance through unchanged", () =>
    Effect.gen(function* () {
      const file = yield* decodeCommBankCsv(homeLoanA, "home-loan");
      const chain = Option.getOrThrow(file.balanceChain);
      const balances = chain.map((row) => row.rowBalance.value);

      expect(chain).toHaveLength(file.rows.length);
      expect(balances[0]).toBeDefined();
      expect(BigDecimal.format(balances[0]!)).toBe("-631422.56");
      expect(balances.every((value) => BigDecimal.isNegative(value))).toBe(true);
    }),
  );

  it.effect("leaves the Mastercard's empty fourth cell as no balance at all", () =>
    Effect.gen(function* () {
      const file = yield* decodeCommBankCsv(mastercardA, "mastercard");

      expect(file.rows.every((row) => row.raw.balance === "")).toBe(true);
      expect(file.rows.every((row) => Option.isNone(row.rowBalance))).toBe(true);
      // No chain to reconcile, so nothing downstream can ask for one.
      expect(Option.isNone(file.balanceChain)).toBe(true);
    }),
  );
});

describe("refusing a file it cannot interpret", () => {
  const rejectionOf = (bytes: Uint8Array, profile: CommBankAccountProfileId = "spending-offset") =>
    Effect.flip(decodeCommBankCsv(bytes, profile));

  it.effect("rejects a header row rather than reading it as a transaction", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(
        synthetic("Date,Amount,Description,Balance", spendingRow),
      );

      expect(rejected).toBeInstanceOf(CommBankCsvRejected);
      expect(rejected.reason).toBe("header_row");
      expect(rejected.sourceOrdinal).toBe(0);
    }),
  );

  it.effect("rejects line feeds without carriage returns", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(new TextEncoder().encode(`${spendingRow}\n`));

      expect(rejected.reason).toBe("line_endings");
    }),
  );

  it.effect("rejects carriage returns without line feeds", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(new TextEncoder().encode(`${spendingRow}\r`));

      expect(rejected.reason).toBe("line_endings");
    }),
  );

  it.effect("rejects a row that is not four cells wide", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(
        synthetic(spendingRow, '28/01/2032,"-50.44","FIXTURE SPENDING OFFSET TRANSACTION 0039"'),
      );

      expect(rejected.reason).toBe("column_count");
      expect(rejected.sourceOrdinal).toBe(1);
      expect(rejected.detail).toContain("found 3");
    }),
  );

  it.effect("rejects a row with a fifth cell", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(synthetic(`${spendingRow},"extra"`));

      expect(rejected.reason).toBe("column_count");
      expect(rejected.detail).toContain("found 5");
    }),
  );

  it.effect("rejects a date that never happened", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(
        synthetic('31/02/2032,"-64.17","FIXTURE SPENDING OFFSET TRANSACTION 0040","6508.36"'),
      );

      expect(rejected.reason).toBe("invalid_date");
      expect(rejected.detail).toContain("calendar date");
    }),
  );

  it.effect("rejects a date written in another order", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(
        synthetic('2032-01-29,"-64.17","FIXTURE SPENDING OFFSET TRANSACTION 0040","6508.36"'),
      );

      expect(rejected.reason).toBe("invalid_date");
    }),
  );

  it.effect("rejects rows that are not newest first", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(
        synthetic(
          '28/01/2032,"-10.00","FIXTURE OLDER TRANSACTION","6572.53"',
          '29/01/2032,"-64.17","FIXTURE NEWER TRANSACTION","6508.36"',
        ),
      );

      expect(rejected.reason).toBe("source_order");
      expect(rejected.sourceOrdinal).toBe(1);
    }),
  );

  it.effect("rejects an amount that is not a decimal", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(
        synthetic('29/01/2032,"-64.17AUD","FIXTURE SPENDING OFFSET TRANSACTION 0040","6508.36"'),
      );

      expect(rejected.reason).toBe("invalid_amount");
    }),
  );

  // An empty cell is the dangerous one: `BigDecimal` reads the empty string as
  // zero, so without the shape check an unpopulated amount would import as a
  // real A$0.00 movement.
  it.effect("rejects an empty amount instead of reading it as zero", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(
        synthetic('29/01/2032,"","FIXTURE SPENDING OFFSET TRANSACTION 0040","6508.36"'),
      );

      expect(rejected.reason).toBe("invalid_amount");
    }),
  );

  it.effect("rejects exponent notation, which no export writes", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(
        synthetic('29/01/2032,"-6.417e1","FIXTURE SPENDING OFFSET TRANSACTION 0040","6508.36"'),
      );

      expect(rejected.reason).toBe("invalid_amount");
    }),
  );

  it.effect("rejects a balance on a profile whose fourth cell must be empty", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(
        synthetic('21/01/2032,"-185.37","FIXTURE MASTERCARD TRANSACTION 0102","1234.56"'),
        "mastercard",
      );

      expect(rejected.reason).toBe("unexpected_balance");
      expect(rejected.sourceOrdinal).toBe(0);
    }),
  );

  it.effect("rejects a missing balance on a profile that carries one", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(
        synthetic('29/01/2032,"-64.17","FIXTURE SPENDING OFFSET TRANSACTION 0040",""'),
      );

      expect(rejected.reason).toBe("missing_balance");
    }),
  );

  it.effect("decodes non-ASCII narrative bytes as Windows-1252", () =>
    Effect.gen(function* () {
      const prefix = new TextEncoder().encode('29/01/2032,"-64.17","CAF');
      const suffix = new TextEncoder().encode('","6508.36"\r\n');
      const bytes = Uint8Array.from([...prefix, 0xe9, ...suffix]);
      const file = yield* decodeCommBankCsv(bytes, "spending-offset");

      expect(file.rows[0]?.raw.narrative).toBe("CAFé");
    }),
  );
});

describe("RFC 4180 quoting", () => {
  it.effect("keeps a quoted comma inside one narrative cell", () =>
    Effect.gen(function* () {
      const file = yield* decodeCommBankCsv(
        synthetic('29/01/2032,"-64.17","FIXTURE GROCER, NEWTOWN","6508.36"'),
        "spending-offset",
      );

      expect(file.rows[0]?.raw.narrative).toBe("FIXTURE GROCER, NEWTOWN");
    }),
  );

  it.effect("keeps a doubled quote as one quote", () =>
    Effect.gen(function* () {
      const file = yield* decodeCommBankCsv(
        synthetic('29/01/2032,"-64.17","FIXTURE ""THE"" CAFE","6508.36"'),
        "spending-offset",
      );

      expect(file.rows[0]?.raw.narrative).toBe('FIXTURE "THE" CAFE');
    }),
  );
});
