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
import { makeDepositPair } from "./synthetic-pair";

const database = usePostgresTestDatabase();
const sha = Schema.decodeUnknownSync(Sha256);

const deps: ImportDeps = {
  identityKey: "transfers-key",
  artifacts: { put: () => Promise.resolve() },
  extractStatement: () => Promise.reject(new Error("no statement extraction in this test")),
};

const withDatabase = <A, E>(effect: Effect.Effect<A, E, Postgres>) =>
  effect.pipe(Effect.provide(Postgres.layerForRequest(database.connectionString())));

const makePair = makeDepositPair;

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
