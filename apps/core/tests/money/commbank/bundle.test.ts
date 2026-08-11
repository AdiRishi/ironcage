import { it } from "@effect/vitest";
import { BigDecimal, Effect, Option } from "effect";
import { describe, expect } from "vitest";

import { CommBankBundleBlocked, decodeCommBankBundle } from "../../../src/money/commbank/bundle";
import type { CommBankAccountProfileId } from "../../../src/money/commbank/profiles";
import homeLoanACsv from "../../fixtures/money/commbank/home-loan/home-loan-a.csv?bytes";
import homeLoanAOfx from "../../fixtures/money/commbank/home-loan/home-loan-a.ofx?bytes";
import mastercardACsv from "../../fixtures/money/commbank/mastercard/mastercard-a.csv?bytes";
import mastercardAOfx from "../../fixtures/money/commbank/mastercard/mastercard-a.ofx?bytes";
import savingsACsv from "../../fixtures/money/commbank/savings-offset/savings-offset-a.csv?bytes";
import savingsAOfx from "../../fixtures/money/commbank/savings-offset/savings-offset-a.ofx?bytes";
import spendingACsv from "../../fixtures/money/commbank/spending-offset/spending-offset-a.csv?bytes";
import spendingAOfx from "../../fixtures/money/commbank/spending-offset/spending-offset-a.ofx?bytes";
import spendingBCsv from "../../fixtures/money/commbank/spending-offset/spending-offset-b.csv?bytes";
import spendingBOfx from "../../fixtures/money/commbank/spending-offset/spending-offset-b.ofx?bytes";
import spendingCCsv from "../../fixtures/money/commbank/spending-offset/spending-offset-c.csv?bytes";
import spendingCOfx from "../../fixtures/money/commbank/spending-offset/spending-offset-c.ofx?bytes";

/**
 * The six downloaded pairs, with the row counts the investigation reviewed by
 * hand and the ledger result each window can actually prove.
 *
 * `outside_covered_window` is not a defect in those two exports. Their windows
 * closed before the files were produced, so `LEDGERBAL` describes a balance
 * later than the newest row, and the rows cannot speak for it.
 */
const corpus = [
  {
    id: "spending-offset-a",
    profile: "spending-offset",
    csv: spendingACsv,
    ofx: spendingAOfx,
    rows: 40,
    ledger: "matched",
  },
  {
    id: "spending-offset-b",
    profile: "spending-offset",
    csv: spendingBCsv,
    ofx: spendingBOfx,
    rows: 25,
    ledger: "outside_covered_window",
  },
  {
    id: "spending-offset-c",
    profile: "spending-offset",
    csv: spendingCCsv,
    ofx: spendingCOfx,
    rows: 23,
    ledger: "matched",
  },
  {
    id: "savings-offset-a",
    profile: "savings-offset",
    csv: savingsACsv,
    ofx: savingsAOfx,
    rows: 40,
    ledger: "outside_covered_window",
  },
  {
    id: "mastercard-a",
    profile: "mastercard",
    csv: mastercardACsv,
    ofx: mastercardAOfx,
    rows: 102,
    ledger: "unavailable",
  },
  {
    id: "home-loan-a",
    profile: "home-loan",
    csv: homeLoanACsv,
    ofx: homeLoanAOfx,
    rows: 36,
    ledger: "matched",
  },
] as const;

/**
 * One transaction as both files would write it. The two exports are rendered
 * from the same list, which is what makes an unpaired row in these tests a
 * deliberate substitution rather than an accident of transcription.
 */
interface SyntheticRow {
  /** `DD/MM/YYYY`, as the CSV writes it. */
  readonly date: string;
  /** The CSV's signed spelling, which carries a `+` the OFX does not. */
  readonly amount: string;
  readonly narrative: string;
  /** The CSV's fourth cell. */
  readonly balance: string;
}

const ofxDate = (date: string) => {
  const [day, month, year] = date.split("/");

  return `${year}${month}${day}`;
};

const unsigned = (amount: string) => amount.replace(/^\+/, "");

const csvOf = (rows: readonly SyntheticRow[]) =>
  new TextEncoder().encode(
    rows
      .map((row) => `${row.date},"${row.amount}","${row.narrative}","${row.balance}"\r\n`)
      .join(""),
  );

const header =
  "OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:USASCII\nCHARSET:1252\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n";

interface OfxOptions {
  readonly window: { readonly start: string; readonly end: string };
  readonly ledger: string;
  readonly asOf: string;
}

const ofxOf = (rows: readonly SyntheticRow[], options: OfxOptions) =>
  new TextEncoder().encode(
    `${header}<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>AUD
<BANKACCTFROM>
<BANKID>999999
<ACCTID>10000001
<ACCTTYPE>SAVINGS
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>${options.window.start}000000
<DTEND>${options.window.end}000000
${rows
  .map(
    (row, index) => `<STMTTRN>
<TRNTYPE>${row.amount.startsWith("-") ? "DEBIT" : "CREDIT"}
<DTPOSTED>${ofxDate(row.date)}
<DTUSER>${ofxDate(row.date)}
<TRNAMT>${unsigned(row.amount)}
<FITID>fixture-fitid-${index}
<MEMO>${row.narrative}
</STMTTRN>
`,
  )
  .join("")}</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>${options.ledger}
<DTASOF>${options.asOf}
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`.replaceAll("\n", "\r\n"),
  );

/**
 * Renders a bundle from one list of transactions. Every override exists to make
 * exactly one file disagree with the other, so a blocked bundle names the
 * disagreement the test introduced.
 */
const bundleOf = (
  rows: readonly SyntheticRow[],
  overrides: {
    readonly ofxRows?: readonly SyntheticRow[];
    readonly window?: { readonly start: string; readonly end: string };
    readonly ledger?: string;
    readonly asOf?: string;
  } = {},
) => {
  const newest = rows[0];
  const oldest = rows.at(-1);
  const window = overrides.window ?? {
    start: oldest === undefined ? "20320101" : ofxDate(oldest.date),
    end: newest === undefined ? "20320131" : ofxDate(newest.date),
  };

  return [
    csvOf(rows),
    ofxOf(overrides.ofxRows ?? rows, {
      window,
      ledger: overrides.ledger ?? unsigned(newest?.balance ?? "0.00"),
      // The observed exports stamp the moment the file was produced. Left to
      // itself the synthetic pair is taken on its newest transaction's day,
      // which is the case where the newest row can speak for the balance.
      asOf: overrides.asOf ?? `${window.end}104618`,
    }),
  ] as const;
};

/** Chronologically oldest last, which is the order every observed export writes. */
const spendingRows = [
  {
    date: "29/01/2032",
    amount: "-64.17",
    narrative: "FIXTURE SPENDING OFFSET TRANSACTION 0002",
    balance: "+6508.36",
  },
  {
    date: "28/01/2032",
    amount: "+1000.00",
    narrative: "FIXTURE SPENDING OFFSET TRANSACTION 0001",
    balance: "+6572.53",
  },
] as const satisfies readonly SyntheticRow[];

const decode = (
  [csv, ofx]: readonly [Uint8Array, Uint8Array],
  profile: CommBankAccountProfileId = "spending-offset",
) => decodeCommBankBundle(csv, ofx, profile);

const blocking = (
  bundle: readonly [Uint8Array, Uint8Array],
  profile: CommBankAccountProfileId = "spending-offset",
) => Effect.flip(decode(bundle, profile));

describe("the observed corpus", () => {
  for (const { id, profile, csv, ofx, rows, ledger } of corpus) {
    it.effect(`${id} pairs row for row`, () =>
      Effect.gen(function* () {
        const bundle = yield* decodeCommBankBundle(csv, ofx, profile);

        expect(bundle.sourceProfile).toBe("cba-netbank-paired-v1");
        expect(bundle.accountProfile).toBe(profile);
        expect(bundle.rows).toHaveLength(rows);
        expect(bundle.ledger.status).toBe(ledger);
        // No observed export repeats a date, amount, and narrative together.
        expect(bundle.rows.every((row) => row.occurrence === 1)).toBe(true);
      }),
    );
  }

  it.effect("keeps both source observations on every candidate", () =>
    Effect.gen(function* () {
      const bundle = yield* decodeCommBankBundle(spendingACsv, spendingAOfx, "spending-offset");
      const first = bundle.rows[0];

      expect(first?.postedDate).toBe("2026-08-08");
      expect(first?.narrative).toBe(
        "TFNSW OPAL FARE SYDNEY AUS Card xx0000 Value Date: 06/08/2026",
      );
      expect(first?.csv.raw.balance).toBe("+21561.27");
      expect(first?.ofx.raw.identifier).toBe("R321140476753_267412");
      // Each file keeps its own position: pairing links observations, it does
      // not merge them into one record that has lost where its facts came from.
      expect(bundle.rows.map((row) => row.csv.sourceOrdinal)).toEqual([...Array(40).keys()]);
      expect(bundle.rows.map((row) => row.ofx.sourceOrdinal)).toEqual([...Array(40).keys()]);
    }),
  );

  it.effect("reads the account identity from the file that carries one", () =>
    Effect.gen(function* () {
      const bundle = yield* decodeCommBankBundle(spendingACsv, spendingAOfx, "spending-offset");

      expect(bundle.account.accountId).toBe("10000001");
      expect(bundle.window).toEqual({ start: "2026-06-20", end: "2026-08-08" });
    }),
  );

  it.effect("proves the newest row against the ledger balance where it can", () =>
    Effect.gen(function* () {
      const bundle = yield* decodeCommBankBundle(homeLoanACsv, homeLoanAOfx, "home-loan");

      expect(bundle.ledger.status).toBe("matched");
      if (bundle.ledger.status !== "matched") return;

      expect(BigDecimal.format(bundle.ledger.ledgerBalance.amount)).toBe("-631422.56");
      expect(BigDecimal.format(bundle.ledger.newestRowBalance)).toBe("-631422.56");
    }),
  );

  // The account kept moving after this window closed, so its ledger balance is
  // A$239.15 above the newest row. Requiring them to agree would block a real
  // export that is entirely correct.
  it.effect("accepts a window that closed before the export was taken", () =>
    Effect.gen(function* () {
      const bundle = yield* decodeCommBankBundle(spendingBCsv, spendingBOfx, "spending-offset");

      expect(bundle.ledger.status).toBe("outside_covered_window");
      if (bundle.ledger.status !== "outside_covered_window") return;

      expect(BigDecimal.format(bundle.ledger.ledgerBalance.amount)).toBe("21561.27");
      expect(BigDecimal.format(bundle.ledger.newestRowBalance)).toBe("21800.42");
    }),
  );

  it.effect("has no ledger claim to make about a card with no row balances", () =>
    Effect.gen(function* () {
      const bundle = yield* decodeCommBankBundle(mastercardACsv, mastercardAOfx, "mastercard");

      expect(bundle.ledger.status).toBe("unavailable");
      expect("newestRowBalance" in bundle.ledger).toBe(false);
      // The balance is still the card's, and still retained: only the CSV had
      // nothing to check it against.
      expect(BigDecimal.format(bundle.ledger.ledgerBalance.amount)).toBe("-4445.5");
      expect(Option.isSome(bundle.availableBalance)).toBe(true);
    }),
  );
});

describe("pairing the two files", () => {
  it.effect("pairs rows whose files spell the same amount differently", () =>
    Effect.gen(function* () {
      const bundle = yield* decode(bundleOf(spendingRows));

      expect(bundle.rows).toHaveLength(2);
      expect(bundle.rows[1]?.csv.raw.amount).toBe("+1000.00");
      expect(bundle.rows[1]?.ofx.raw.amount).toBe("1000.00");
      expect(bundle.rows[1]).toBeDefined();
      expect(BigDecimal.format(bundle.rows[1]!.amount)).toBe("1000");
    }),
  );

  // Nothing in either file distinguishes these two rows. Their order is the
  // only evidence there is, so each is claimed exactly once, in that order.
  it.effect("numbers repeated equal rows by their occurrence in source order", () =>
    Effect.gen(function* () {
      const repeated = [
        { date: "29/01/2032", amount: "-25.00", narrative: "FIXTURE CAFE", balance: "+950.00" },
        { date: "29/01/2032", amount: "-25.00", narrative: "FIXTURE CAFE", balance: "+975.00" },
        {
          date: "28/01/2032",
          amount: "+1000.00",
          narrative: "FIXTURE SALARY",
          balance: "+1000.00",
        },
      ] as const satisfies readonly SyntheticRow[];
      const bundle = yield* decode(bundleOf(repeated));

      expect(bundle.rows.map((row) => row.occurrence)).toEqual([1, 2, 1]);
      expect(bundle.rows.map((row) => row.ofx.raw.identifier)).toEqual([
        "fixture-fitid-0",
        "fixture-fitid-1",
        "fixture-fitid-2",
      ]);
    }),
  );

  it.effect("accepts an export that returned nothing", () =>
    Effect.gen(function* () {
      const bundle = yield* decode(
        bundleOf([], {
          window: { start: "20320101", end: "20320131" },
          ledger: "6508.36",
          asOf: "20320131104618",
        }),
      );

      expect(bundle.rows).toHaveLength(0);
      expect(bundle.ledger.status).toBe("unavailable");
      expect(bundle.window).toEqual({ start: "2032-01-01", end: "2032-01-31" });
    }),
  );

  it.effect("blocks when the two files hold different numbers of rows", () =>
    Effect.gen(function* () {
      const blocked = yield* blocking(
        bundleOf(spendingRows, { ofxRows: spendingRows.slice(0, 1) }),
      );

      expect(blocked).toBeInstanceOf(CommBankBundleBlocked);
      expect(blocked.reason).toBe("row_count_mismatch");
      expect(blocked.detail).toContain("2 rows and the OFX holds 1");
    }),
  );

  it.effect("blocks a row the other file describes differently", () =>
    Effect.gen(function* () {
      const blocked = yield* blocking(
        bundleOf(spendingRows, {
          ofxRows: [
            { ...spendingRows[0], narrative: "FIXTURE SPENDING OFFSET TRANSACTION 0003" },
            spendingRows[1],
          ],
        }),
      );

      expect(blocked.reason).toBe("unpaired_row");
      expect(blocked.sourceOrdinal).toBe(0);
    }),
  );

  it.effect("blocks a row the other file dates differently", () =>
    Effect.gen(function* () {
      const blocked = yield* blocking(
        bundleOf(spendingRows, {
          ofxRows: [{ ...spendingRows[0], date: "28/01/2032" }, spendingRows[1]],
        }),
      );

      expect(blocked.reason).toBe("unpaired_row");
    }),
  );
});

describe("the export ceiling", () => {
  /** A chain of A$1.00 debits, oldest last, so the balances close exactly. */
  const series = (count: number): readonly SyntheticRow[] =>
    Array.from({ length: count }, (_, index) => {
      const cents = 10_000_000 - (count - index) * 100;

      return {
        date: "29/01/2032",
        amount: "-1.00",
        narrative: `FIXTURE SPENDING OFFSET TRANSACTION ${String(count - index).padStart(4, "0")}`,
        balance: `+${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`,
      };
    });

  it.effect("accepts an export one row below the ceiling", () =>
    Effect.gen(function* () {
      const bundle = yield* decode(bundleOf(series(599)));

      expect(bundle.rows).toHaveLength(599);
    }),
  );

  // NetBank returned exactly 600 rows for a broad search and dropped the older
  // ones without saying so. The file cannot tell the two cases apart, so it
  // cannot support a coverage claim either way.
  it.effect("blocks an export sitting exactly on the ceiling", () =>
    Effect.gen(function* () {
      const blocked = yield* blocking(bundleOf(series(600)));

      expect(blocked.reason).toBe("export_truncated");
      expect(blocked.sourceOrdinal).toBeNull();
    }),
  );

  it.effect("blocks a source claiming more rows than NetBank can export", () =>
    Effect.gen(function* () {
      const blocked = yield* blocking(bundleOf(series(601)));

      expect(blocked.reason).toBe("export_truncated");
      expect(blocked.detail).toContain("601 rows");
    }),
  );
});

describe("reconciling the balances", () => {
  it.effect("blocks a running balance that does not follow from the row before it", () =>
    Effect.gen(function* () {
      const rows = [
        { date: "29/01/2032", amount: "-64.17", narrative: "FIXTURE CAFE", balance: "+6508.36" },
        { date: "28/01/2032", amount: "-10.00", narrative: "FIXTURE BUS", balance: "+6572.55" },
        {
          date: "27/01/2032",
          amount: "+1000.00",
          narrative: "FIXTURE SALARY",
          balance: "+6582.53",
        },
      ] as const satisfies readonly SyntheticRow[];
      const blocked = yield* blocking(bundleOf(rows));

      // 6582.53 - 10.00 is 6572.53, two cents under what the middle row
      // records. Both rows above it inherit the break; it is reported where the
      // chain first fails, which is the row that recorded the wrong balance.
      expect(blocked.reason).toBe("balance_chain");
      expect(blocked.sourceOrdinal).toBe(1);
    }),
  );

  it.effect("accepts a chain whose first row has no predecessor in the file", () =>
    Effect.gen(function* () {
      const bundle = yield* decode(bundleOf(spendingRows));

      // The oldest row's balance is a starting point, not a claim the file can
      // prove. Only the rows above it are checked.
      expect(bundle.rows.at(-1)?.csv.raw.balance).toBe("+6572.53");
      expect(bundle.ledger.status).toBe("matched");
    }),
  );

  it.effect("blocks a ledger balance the newest row contradicts", () =>
    Effect.gen(function* () {
      const blocked = yield* blocking(bundleOf(spendingRows, { ledger: "6508.37" }));

      expect(blocked.reason).toBe("ledger_disagreement");
      expect(blocked.sourceOrdinal).toBe(0);
      expect(blocked.detail).toContain("+6508.36");
    }),
  );

  it.effect("makes no ledger claim when the export was taken after the window closed", () =>
    Effect.gen(function* () {
      const bundle = yield* decode(
        bundleOf(spendingRows, { ledger: "9999.99", asOf: "20320205104618" }),
      );

      expect(bundle.ledger.status).toBe("outside_covered_window");
      expect(BigDecimal.format(bundle.ledger.ledgerBalance.amount)).toBe("9999.99");
    }),
  );
});
