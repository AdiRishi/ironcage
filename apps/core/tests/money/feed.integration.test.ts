import { expect, it } from "@effect/vitest";
import type { BankAccountSummary, BankImportSource } from "@ironcage/contracts/schema";
import { RequestId, Sha256 } from "@ironcage/domain";
import { Effect, Schema } from "effect";

import { mintId } from "../../src/ids";
import { acknowledge, getFeed } from "../../src/money/feed";
import { confirmBankImport, previewBankImport, type ImportDeps } from "../../src/money/import";
import { configureBankAccount } from "../../src/money/queries";
import { Postgres } from "../../src/persistence/postgres";
import { usePostgresTestDatabase } from "../persistence/postgres-test-database";
import { makeDepositPair } from "./synthetic-pair";

const database = usePostgresTestDatabase();
const sha = Schema.decodeUnknownSync(Sha256);

const deps: ImportDeps = {
  identityKey: "feed-key",
  artifacts: { put: () => Promise.resolve() },
};

const withDatabase = <A, E>(effect: Effect.Effect<A, E, Postgres>) =>
  effect.pipe(Effect.provide(Postgres.layerForRequest(database.connectionString())));

const readFeed = () =>
  withDatabase(getFeed({ cursor: null, categories: [], severities: [], limit: 50 }));

const importPair = (
  account: BankAccountSummary,
  pair: { readonly csv: Uint8Array; readonly ofx: Uint8Array },
) =>
  Effect.gen(function* () {
    const source: BankImportSource = {
      kind: "commbank_structured",
      accountId: account.id,
      csv: { displayName: "CSVData.csv", bytes: pair.csv },
      ofx: { displayName: "OFXData.ofx", bytes: pair.ofx },
    };
    const preview = yield* withDatabase(previewBankImport(source, deps));
    if (preview.kind !== "ready") throw new Error("expected a ready preview");
    return yield* withDatabase(
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
  });

it.effect("imports write feed events; gaps are detected and closed; acknowledgment sticks", () =>
  Effect.gen(function* () {
    const account = yield* withDatabase(
      configureBankAccount({
        requestId: yield* mintId(RequestId),
        payloadHash: sha("1".repeat(64)),
        productLabel: "Spending offset",
        accountType: "deposit",
        required: true,
        openedOn: null,
        closedOn: null,
      }),
    );

    yield* importPair(
      account,
      makeDepositPair(
        "10000001",
        [{ date: "05/01/2032", amount: "100.00", narrative: "OPENING", balance: "100.00" }],
        ["01/01/2032", "10/01/2032"],
      ),
    );

    const first = yield* readFeed();
    expect(first.events).toHaveLength(1);
    expect(first.events[0]!.eventType).toBe("bank_import_completed");
    expect(first.events[0]!.acknowledgedAt).toBeNull();

    // A disjoint later window opens a gap between the two segments.
    yield* importPair(
      account,
      makeDepositPair(
        "10000001",
        [{ date: "22/01/2032", amount: "-20.00", narrative: "COFFEE", balance: "80.00" }],
        ["20/01/2032", "25/01/2032"],
      ),
    );

    const afterDisjoint = yield* readFeed();
    const detected = afterDisjoint.events.filter(
      (event) => event.eventType === "bank_gap_detected",
    );
    expect(detected).toHaveLength(1);
    expect(detected[0]!.summary).toContain("2032-01-11..2032-01-19");

    // A bridging window closes it again.
    yield* importPair(
      account,
      makeDepositPair(
        "10000001",
        [{ date: "12/01/2032", amount: "-10.00", narrative: "SNACK", balance: "90.00" }],
        ["08/01/2032", "21/01/2032"],
      ),
    );

    const afterBridge = yield* readFeed();
    expect(
      afterBridge.events.filter((event) => event.eventType === "bank_gap_closed"),
    ).toHaveLength(1);

    // Acknowledgment is append-only and idempotent.
    const acknowledged = yield* withDatabase(
      acknowledge({
        requestId: yield* mintId(RequestId),
        payloadHash: sha("2".repeat(64)),
        eventId: first.events[0]!.id,
      }),
    );
    expect(acknowledged.acknowledgedAt).not.toBeNull();

    const finalFeed = yield* readFeed();
    const acknowledgedEvent = finalFeed.events.find((event) => event.id === first.events[0]!.id)!;
    expect(acknowledgedEvent.acknowledgedAt).not.toBeNull();
  }),
);

it.effect("a blocked preview emits no feed event", () =>
  Effect.gen(function* () {
    const account = yield* withDatabase(
      configureBankAccount({
        requestId: yield* mintId(RequestId),
        payloadHash: sha("3".repeat(64)),
        productLabel: "Spending offset",
        accountType: "deposit",
        required: true,
        openedOn: null,
        closedOn: null,
      }),
    );

    // The second row's balance breaks the chain: 100 − 20 ≠ 90.
    const pair = makeDepositPair(
      "10000001",
      [
        { date: "05/01/2032", amount: "100.00", narrative: "OPENING", balance: "100.00" },
        { date: "06/01/2032", amount: "-20.00", narrative: "COFFEE", balance: "90.00" },
      ],
      ["01/01/2032", "10/01/2032"],
    );
    const blocked = yield* withDatabase(
      previewBankImport(
        {
          kind: "commbank_structured",
          accountId: account.id,
          csv: { displayName: "CSVData.csv", bytes: pair.csv },
          ofx: { displayName: "OFXData.ofx", bytes: pair.ofx },
        },
        deps,
      ),
    );
    expect(blocked.kind).toBe("blocked");

    expect((yield* readFeed()).events).toHaveLength(0);
  }),
);
