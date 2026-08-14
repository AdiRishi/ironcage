import { expect, it } from "@effect/vitest";
import type { BankAccountSummary, BankImportSource } from "@ironcage/contracts/schema";
import { RequestId, Sha256 } from "@ironcage/domain";
import { Effect, Schema } from "effect";

import { mintId } from "../../src/ids";
import { confirmBankImport, previewBankImport, type ImportDeps } from "../../src/money/import";
import { configureBankAccount } from "../../src/money/queries";
import { decideTransferMatch, getTransferMatches } from "../../src/money/transfers";
import { Postgres } from "../../src/persistence/postgres";
import { usePostgresTestDatabase } from "../persistence/postgres-test-database";

const database = usePostgresTestDatabase();
const sha = Schema.decodeUnknownSync(Sha256);

const deps: ImportDeps = {
  identityKey: "transfers-key",
  artifacts: { put: () => Promise.resolve() },
};

const withDatabase = <A, E>(effect: Effect.Effect<A, E, Postgres>) =>
  effect.pipe(Effect.provide(Postgres.layerForRequest(database.connectionString())));

interface Row {
  readonly date: string; // DD/MM/YYYY
  readonly amount: string; // signed, two decimals
  readonly narrative: string;
  readonly balance: string; // signed running balance
}

const signedForCsv = (value: string) => (value.startsWith("-") ? value : `+${value}`);
const ofxDate = (date: string) => `${date.slice(6)}${date.slice(3, 5)}${date.slice(0, 2)}`;

/** Builds a valid deposit CSV/OFX pair from oldest-first rows. */
const makePair = (acctId: string, oldestFirst: readonly Row[], window: [string, string]) => {
  const newestFirst = [...oldestFirst].reverse();
  const csv = `${newestFirst
    .map(
      (row) =>
        `${row.date},"${signedForCsv(row.amount)}","${row.narrative}","${signedForCsv(row.balance)}"`,
    )
    .join("\r\n")}\r\n`;

  const transactions = newestFirst
    .map(
      (row, index) =>
        `<STMTTRN>\r\n<TRNTYPE>${row.amount.startsWith("-") ? "DEBIT" : "CREDIT"}\r\n<DTPOSTED>${ofxDate(row.date)}\r\n<DTUSER>${ofxDate(row.date)}\r\n<TRNAMT>${row.amount}\r\n<FITID>f-${acctId}-${index}\r\n<MEMO>${row.narrative}\r\n</STMTTRN>\r\n`,
    )
    .join("");
  const newest = newestFirst[0]!;
  const ofx =
    `OFXHEADER:100\r\nDATA:OFXSGML\r\nVERSION:102\r\nSECURITY:NONE\r\nENCODING:USASCII\r\nCHARSET:1252\r\nCOMPRESSION:NONE\r\nOLDFILEUID:NONE\r\nNEWFILEUID:NONE\r\n` +
    `<OFX>\r\n<SIGNONMSGSRSV1>\r\n<SONRS>\r\n<STATUS>\r\n<CODE>0\r\n<SEVERITY>INFO\r\n</STATUS>\r\n<DTSERVER>${ofxDate(window[1])}104618\r\n<LANGUAGE>ENG\r\n</SONRS>\r\n</SIGNONMSGSRSV1>\r\n` +
    `<BANKMSGSRSV1>\r\n<STMTTRNRS>\r\n<TRNUID>0\r\n<STATUS>\r\n<CODE>0\r\n<SEVERITY>INFO\r\n</STATUS>\r\n<STMTRS>\r\n<CURDEF>AUD\r\n` +
    `<BANKACCTFROM>\r\n<BANKID>999999\r\n<ACCTID>${acctId}\r\n<ACCTTYPE>SAVINGS\r\n</BANKACCTFROM>\r\n` +
    `<BANKTRANLIST>\r\n<DTSTART>${ofxDate(window[0])}000000\r\n<DTEND>${ofxDate(window[1])}000000\r\n${transactions}</BANKTRANLIST>\r\n` +
    `<LEDGERBAL>\r\n<BALAMT>${newest.balance}\r\n<DTASOF>${ofxDate(window[1])}104618\r\n</LEDGERBAL>\r\n` +
    `</STMTRS>\r\n</STMTTRNRS>\r\n</BANKMSGSRSV1>\r\n</OFX>\r\n`;

  const encode = (text: string) => new TextEncoder().encode(text);
  return { csv: encode(csv), ofx: encode(ofx) };
};

const importPair = (account: BankAccountSummary, pair: { csv: Uint8Array; ofx: Uint8Array }) =>
  Effect.gen(function* () {
    const source: BankImportSource = {
      kind: "commbank_structured",
      accountId: account.id,
      csv: { displayName: "CSVData.csv", bytes: pair.csv },
      ofx: { displayName: "OFXData.ofx", bytes: pair.ofx },
    };
    const preview = yield* withDatabase(previewBankImport(source, deps));
    if (preview.kind !== "ready") {
      throw new Error(`expected ready preview: ${JSON.stringify(preview)}`);
    }
    const confirmed = yield* withDatabase(
      confirmBankImport(
        {
          source,
          expectedBundleDigest: preview.preview.bundleDigest,
          expectedPreviewFingerprint: preview.preview.previewFingerprint,
          resolutions: [],
          requestId: yield* mintId(RequestId),
        },
        deps,
      ),
    );
    if (confirmed.kind !== "confirmed") throw new Error("expected a confirmed import");
  });

const configure = (label: string, hashSeed: string) =>
  withDatabase(
    configureBankAccount({
      requestId: Effect.runSync(mintId(RequestId)),
      payloadHash: sha(hashSeed.repeat(64).slice(0, 64)),
      productLabel: label,
      accountType: "deposit",
      required: true,
      openedOn: null,
      closedOn: null,
    }),
  );

it.effect("auto-confirms sole pairings and leaves ambiguous sets to the operator", () =>
  Effect.gen(function* () {
    const spending = yield* configure("Spending offset", "a");
    const savings = yield* configure("Savings offset", "b");

    yield* importPair(
      spending,
      makePair(
        "10000001",
        [
          { date: "10/01/2032", amount: "1500.00", narrative: "SALARY", balance: "1500.00" },
          { date: "12/01/2032", amount: "-500.00", narrative: "PAY ONE", balance: "1000.00" },
          { date: "13/01/2032", amount: "-750.00", narrative: "PAY EXACT", balance: "250.00" },
          { date: "14/01/2032", amount: "-500.00", narrative: "PAY TWO", balance: "-250.00" },
        ],
        ["01/01/2032", "20/01/2032"],
      ),
    );
    yield* importPair(
      savings,
      makePair(
        "10000002",
        [
          { date: "05/01/2032", amount: "300.00", narrative: "OPENING", balance: "300.00" },
          { date: "13/01/2032", amount: "500.00", narrative: "RECEIVE ONE", balance: "800.00" },
          { date: "13/01/2032", amount: "750.00", narrative: "RECEIVE EXACT", balance: "1550.00" },
          { date: "15/01/2032", amount: "500.00", narrative: "RECEIVE TWO", balance: "2050.00" },
        ],
        ["01/01/2032", "20/01/2032"],
      ),
    );

    // The -750/+750 pair is the only possibility for both legs and
    // auto-confirmed; the two -500/+500 squares stay unresolved.
    const initial = yield* withDatabase(getTransferMatches());
    expect(initial.matches).toHaveLength(1);
    expect(initial.matches[0]!.method).toBe("sole_pairing");
    expect(initial.matches[0]!.a.narrative).toBe("PAY EXACT");
    expect(initial.unresolved).toHaveLength(2);
    expect(initial.unresolved.every((group) => group.counterparts.length === 2)).toBe(true);

    // The operator confirms one pairing; its legs leave the pool.
    const first = initial.unresolved.find((group) => group.transaction.narrative === "PAY ONE")!;
    const decided = yield* withDatabase(
      decideTransferMatch({
        requestId: yield* mintId(RequestId),
        payloadHash: sha("c".repeat(64)),
        transactionA: first.transaction.transactionId,
        transactionB: first.counterparts[0]!.transactionId,
        decision: "confirm",
      }),
    );
    expect(decided.status).toBe("confirmed");
    expect(decided.method).toBe("operator");

    const afterConfirm = yield* withDatabase(getTransferMatches());
    expect(afterConfirm.matches).toHaveLength(2);
    expect(afterConfirm.unresolved).toHaveLength(1);
    expect(afterConfirm.unresolved[0]!.counterparts).toHaveLength(1);

    // Dismissing the last pairing empties the pool without linking it.
    const last = afterConfirm.unresolved[0]!;
    yield* withDatabase(
      decideTransferMatch({
        requestId: yield* mintId(RequestId),
        payloadHash: sha("d".repeat(64)),
        transactionA: last.transaction.transactionId,
        transactionB: last.counterparts[0]!.transactionId,
        decision: "dismiss",
      }),
    );

    const final = yield* withDatabase(getTransferMatches());
    expect(final.unresolved).toHaveLength(0);
    expect(final.matches.filter((match) => match.status === "confirmed")).toHaveLength(2);
  }),
);

it.effect("an agreeing bank reference confirms a pairing that is not sole", () =>
  Effect.gen(function* () {
    const spending = yield* configure("Spending offset", "e");
    const savings = yield* configure("Savings offset", "f");

    yield* importPair(
      spending,
      makePair(
        "10000001",
        [
          {
            date: "12/01/2032",
            amount: "-500.00",
            narrative: "Transfer to NetBank 900000123",
            balance: "-500.00",
          },
        ],
        ["01/01/2032", "20/01/2032"],
      ),
    );
    yield* importPair(
      savings,
      makePair(
        "10000002",
        [
          {
            date: "12/01/2032",
            amount: "500.00",
            narrative: "Transfer from NetBank 900000123",
            balance: "500.00",
          },
          { date: "13/01/2032", amount: "500.00", narrative: "CASH DEPOSIT", balance: "1000.00" },
        ],
        ["01/01/2032", "20/01/2032"],
      ),
    );

    const result = yield* withDatabase(getTransferMatches());
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.method).toBe("reference");
    expect(result.matches[0]!.b.narrative).toBe("Transfer from NetBank 900000123");
    expect(result.unresolved).toHaveLength(0);
  }),
);
