import { existsSync, readdirSync, readFileSync } from "node:fs";
import { URL } from "node:url";

import { PgClient } from "@effect/sql-pg";
import {
  CommandId,
  FinanceError,
  ImportSummary,
  type ParsedFile,
  ResolveReview,
  YearMonth,
} from "@repo/contracts/finance";
import { parseCsv, parseOfx } from "@repo/processor/imports";
import { Crypto, Console, Duration, Effect, Schema } from "effect";
import { expect } from "vitest";

import { Accounts } from "../../src/accounts/service.ts";
import { Flows } from "../../src/analysis/flows.ts";
import { Commands } from "../../src/database/commands.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Postings } from "../../src/postings/service.ts";
import { Reviews } from "../../src/review/service.ts";
import { applicationTest } from "../support/application.ts";
import { account, openQuestions, parsed, parsedRows, reset, source } from "../support/fixtures.ts";

const { test, services } = applicationTest();

test(
  "concurrent overlapping files keep both identical transactions and attach four source rows",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const first = yield* source(owner.id);
    const second = yield* source(owner.id);
    const publication = yield* Publication;
    const results = yield* Effect.all(
      [
        publication.publish({ ...parsed(["Coffee", "Coffee"]), importId: first.importId }),
        publication.publish({ ...parsed(["Coffee", "Coffee"]), importId: second.importId }),
      ],
      { concurrency: 2 },
    );
    expect(results.map((result) => result.newPostings).sort((left, right) => left - right)).toEqual(
      [0, 2],
    );
    const postings = yield* Postings;
    const page = yield* postings.list({ filter: {} });
    expect(page.rows).toHaveLength(2);
    for (const row of page.rows)
      expect((yield* postings.get({ postingId: row.id })).evidence).toHaveLength(2);
  }).pipe(Effect.provide(services)),
);

test(
  "a lost publication response can be retried without adding transactions",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const file = yield* source(owner.id);
    const publication = yield* Publication;
    const input = { ...parsed(["Coffee"]), importId: file.importId };
    const committed = yield* publication.publish(input);
    expect(yield* publication.publish(input)).toEqual(committed);
    const postings = yield* Postings;
    expect((yield* postings.list({ filter: {} })).rows).toHaveLength(1);
  }).pipe(Effect.provide(services)),
);

test(
  "an ambiguous row stays unpublished until its explicit match is resolved once",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const first = yield* source(owner.id);
    const second = yield* source(owner.id);
    const publication = yield* Publication;
    yield* publication.publish({ ...parsed(["Coffee", "Coffee"]), importId: first.importId });
    const pending = yield* publication.publish({
      ...parsed(["Coffee"]),
      importId: second.importId,
    });
    expect(pending).toEqual({
      observations: 1,
      newPostings: 0,
      matchedPostings: 0,
      reviewItems: 1,
    });
    const postingsForReview = yield* Postings;
    expect((yield* postingsForReview.list({ filter: { needsReview: true } })).rows).toHaveLength(2);
    expect((yield* postingsForReview.list({ filter: { needsReview: false } })).rows).toHaveLength(
      0,
    );
    const reviews = yield* Reviews;
    const [review] = (yield* reviews.list()).rows;
    expect(review?.kind).toBe("duplicate");
    expect(review?.candidates).toHaveLength(2);
    if (!review?.observations[0] || !review.candidates[0])
      return yield* Effect.die("Expected a review with choices.");
    const command: typeof ResolveReview.Type = {
      commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
      reviewItemId: review.id,
      expectedVersion: review.version,
      resolution: {
        kind: "observations" as const,
        decisions: [
          {
            observationId: review.observations[0].id,
            decision: { kind: "match" as const, postingId: review.candidates[0].id },
          },
        ],
      },
    };
    const resolved = yield* reviews.resolve(command);
    expect(resolved.reviewItems).toBe(0);
    expect(yield* reviews.resolve(command)).toEqual(resolved);
    expect((yield* reviews.list()).rows).toHaveLength(0);
    const stale = yield* reviews
      .resolve({
        ...command,
        commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
      })
      .pipe(Effect.flip);
    expect(stale.kind).toBe("stale");
    const postings = yield* Postings;
    expect((yield* postings.list({ filter: {} })).rows).toHaveLength(2);
  }).pipe(Effect.provide(services)),
);

test(
  "a changed parser reading leaves the transaction intact and keeping it survives later reparses",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const file = yield* source(owner.id);
    const publication = yield* Publication;
    yield* publication.publish({ ...parsed(["Coffee"]), importId: file.importId });
    yield* publication.publish({
      ...parsed(["Different reading"]),
      parserVersion: "test-2",
      importId: file.importId,
    });
    const postings = yield* Postings;
    expect((yield* postings.list({ filter: {} })).rows[0]?.description).toBe("Coffee");
    const reviews = yield* Reviews;
    const [review] = (yield* reviews.list()).rows;
    const row = review?.observations[0];
    if (!review || !row?.acceptedCandidate || !row.postingId)
      return yield* Effect.die("Expected the prior accepted source row.");
    expect(review.kind).toBe("source_conflict");
    yield* reviews.resolve({
      commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
      reviewItemId: review.id,
      expectedVersion: review.version,
      resolution: {
        kind: "observations",
        decisions: [
          {
            observationId: row.id,
            decision: { kind: "keep", candidate: row.acceptedCandidate, postingId: row.postingId },
          },
        ],
      },
    });
    yield* publication.publish({
      ...parsed(["Another reading"]),
      parserVersion: "test-3",
      importId: file.importId,
    });
    expect((yield* reviews.list()).rows).toHaveLength(0);
    expect((yield* postings.list({ filter: {} })).rows[0]?.description).toBe("Coffee");
  }).pipe(Effect.provide(services)),
);

test(
  "a failed command rolls back its writes and can retry with the same command ID",
  Effect.gen(function* () {
    yield* reset;
    const commands = yield* Commands;
    const sql = yield* PgClient.PgClient;
    const commandId = CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4));
    const accountId = yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4);
    const result = { observations: 0, newPostings: 0, matchedPostings: 0, reviewItems: 0 };
    const command = {
      commandId,
      input: { kind: "rollback-fixture" },
      result: Schema.toCodecJson(ImportSummary),
    };
    const failed = yield* commands
      .run({
        ...command,
        execute: Effect.gen(function* () {
          yield* sql`INSERT INTO accounts (id, kind, institution, label, currency) VALUES (${accountId}, 'deposit', 'commbank', 'Uncommitted', 'AUD')`;
          return yield* new FinanceError({
            kind: "unavailable",
            message: "Injected failure before commit.",
          });
        }),
      })
      .pipe(Effect.flip);
    expect(failed.kind).toBe("unavailable");
    const accounts = yield* Accounts;
    expect(yield* accounts.list).toHaveLength(0);
    expect(yield* commands.run({ ...command, execute: Effect.succeed(result) })).toEqual(result);
  }).pipe(Effect.provide(services)),
);

const corpusDirectory = new URL("../../../../fixtures/commbank/", import.meta.url);
test.skipIf(!existsSync(corpusDirectory))(
  "every private OFX can publish independently",
  Effect.gen(function* () {
    const files = readdirSync(corpusDirectory).filter((name) => name.endsWith(".ofx"));
    const publication = yield* Publication;
    let observed = 0;
    let largest = { observations: 0, milliseconds: 0 };
    for (const file of files) {
      yield* reset;
      const bytes = new Uint8Array(readFileSync(new URL(file, corpusDirectory)));
      const expected = new TextDecoder("windows-1252").decode(bytes).split("<STMTTRN>").length - 1;
      const parsedFile = yield* parseOfx(bytes);
      const upload = yield* source(null, "ofx");
      const [duration, summary] = yield* Effect.timed(
        publication.publish({ ...parsedFile, importId: upload.importId }),
      );
      if (expected > largest.observations)
        largest = { observations: expected, milliseconds: Duration.toMillis(duration) };
      expect(summary).toEqual({
        observations: expected,
        newPostings: expected,
        matchedPostings: 0,
        reviewItems: 0,
      });
      observed += expected;
    }
    expect(files).toHaveLength(26);
    expect(observed).toBe(3031);
    yield* Console.info("Largest structured import publication", largest);
  }).pipe(Effect.provide(services)),
  { timeout: 120_000 },
);

test.skipIf(!existsSync(corpusDirectory))(
  "the entire CSV and OFX corpus produces the same 2919 transactions in either upload order",
  Effect.gen(function* () {
    const ofxFiles = readdirSync(corpusDirectory)
      .filter((name) => name.endsWith(".ofx"))
      .sort();
    const pairs = yield* Effect.forEach(
      ofxFiles,
      Effect.fn(function* (file) {
        const ofx = yield* parseOfx(new Uint8Array(readFileSync(new URL(file, corpusDirectory))));
        const csvName = file.replace(/b_(.*)\.ofx$/, "a_$1.csv");
        const csv = yield* parseCsv(
          new Uint8Array(readFileSync(new URL(csvName, corpusDirectory))),
          "AUD",
        );
        if (!ofx.account)
          return yield* Effect.die("Expected the corpus envelope to identify an account.");
        return { csv, ofx, identity: ofx.account };
      }),
    );
    const accounts = yield* Accounts;
    const publication = yield* Publication;
    const postings = yield* Postings;
    const reviews = yield* Reviews;
    let baseline: ReadonlyArray<string> | undefined;
    for (const reverse of [false, true]) {
      yield* reset;
      const owners = new Map<string, Effect.Success<ReturnType<typeof accounts.create>>>();
      for (const pair of pairs)
        if (!owners.has(pair.identity.accountNumber))
          owners.set(
            pair.identity.accountNumber,
            yield* accounts.create({
              commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
              label: `Corpus account ${owners.size + 1}`,
              kind: pair.identity.kind,
              institution: "commbank",
              currency: pair.identity.currency,
            }),
          );
      const files = [
        ...pairs.map((pair) => ({ ...pair, parsedFile: pair.csv, format: "csv" as const })),
        ...pairs.map((pair) => ({ ...pair, parsedFile: pair.ofx, format: "ofx" as const })),
      ];
      if (reverse) files.reverse();
      let observed = 0;
      for (const file of files) {
        const owner = owners.get(file.identity.accountNumber);
        if (!owner) return yield* Effect.die("Expected a corpus account.");
        const upload = yield* source(owner.id, file.format);
        const summary = yield* publication.publish({
          ...file.parsedFile,
          importId: upload.importId,
        });
        expect(summary.reviewItems).toBe(0);
        observed += summary.observations;
      }
      const canonical: string[] = [];
      for (const [identity, owner] of owners) {
        let page = yield* postings.list({ filter: { accountId: owner.id } });
        while (true) {
          for (const row of page.rows)
            canonical.push(
              JSON.stringify({
                identity,
                postedOn: row.postedOn,
                valueOn: row.valueOn,
                amount: row.amount.minor.toString(),
                currency: row.amount.currency,
                description: row.description,
                originalCurrency: row.originalMoney?.currency,
                originalAmount: row.originalMoney?.minor.toString(),
              }),
            );
          if (!page.nextCursor) break;
          page = yield* postings.list({ filter: { accountId: owner.id }, cursor: page.nextCursor });
        }
      }
      canonical.sort();
      expect(observed).toBe(6062);
      expect(canonical.length).toBe(2919);
      expect((yield* reviews.list()).rows).toHaveLength(0);
      if (baseline) expect(JSON.stringify(canonical) === JSON.stringify(baseline)).toBe(true);
      baseline = canonical;
    }
  }).pipe(Effect.provide(services)),
  { timeout: 180_000 },
);

test(
  "a reviewed unreadable value publishes alongside its valid source rows",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const file = yield* source(owner.id);
    const parsedFile = yield* parseCsv(
      new TextEncoder().encode("31/02/2026,-5.00,Coffee,\n01/02/2026,100.00,Deposit,"),
      "AUD",
    );
    const publication = yield* Publication;
    expect(yield* publication.publish({ ...parsedFile, importId: file.importId })).toEqual({
      observations: 2,
      newPostings: 1,
      matchedPostings: 0,
      reviewItems: 1,
    });
    const reviews = yield* Reviews;
    const [review] = (yield* reviews.list()).rows;
    const row = review?.observations[0];
    if (!review || !row) return yield* Effect.die("Expected the unreadable source row.");
    const correction = parsed(["Coffee"]).observations[0]?.candidate;
    if (!correction) return yield* Effect.die("Expected a decoded correction.");
    yield* reviews.resolve({
      commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
      reviewItemId: review.id,
      expectedVersion: review.version,
      resolution: {
        kind: "observations",
        decisions: [
          {
            observationId: row.id,
            decision: { kind: "correct", candidate: correction, postingId: null },
          },
        ],
      },
    });
    const postings = yield* Postings;
    expect((yield* postings.list({ filter: {} })).rows).toHaveLength(2);
    expect((yield* reviews.list()).rows).toHaveLength(0);
  }).pipe(Effect.provide(services)),
);

test(
  "two source rows cannot claim the same transaction in a review",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const first = yield* source(owner.id);
    const second = yield* source(owner.id);
    const publication = yield* Publication;
    yield* publication.publish({ ...parsed(["Cafe", "Bakery"]), importId: first.importId });
    yield* publication.publish({
      ...parsed(["Merchant A", "Merchant B"]),
      importId: second.importId,
    });
    const reviews = yield* Reviews;
    const [review] = (yield* reviews.list()).rows;
    const choice = review?.candidates[0];
    const firstRow = review?.observations[0];
    const secondRow = review?.observations[1];
    if (!review || !choice || !firstRow || !secondRow)
      return yield* Effect.die("Expected two ambiguous rows.");
    const failure = yield* reviews
      .resolve({
        commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
        reviewItemId: review.id,
        expectedVersion: review.version,
        resolution: {
          kind: "observations",
          decisions: [
            { observationId: firstRow.id, decision: { kind: "match", postingId: choice.id } },
            { observationId: secondRow.id, decision: { kind: "match", postingId: choice.id } },
          ],
        },
      })
      .pipe(Effect.flip);
    expect(failure.kind).toBe("invalid");
    const postings = yield* Postings;
    expect((yield* postings.get({ postingId: choice.id })).evidence).toHaveLength(1);
    expect((yield* reviews.list()).rows).toHaveLength(1);
  }).pipe(Effect.provide(services)),
);

// A synthetic OFX export of the deposit account 062000 12345678.
const depositOfx = (statement: string) =>
  parseOfx(
    new TextEncoder().encode(`OFXHEADER:100
DATA:OFXSGML
VERSION:102
ENCODING:USASCII
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>AUD
<BANKACCTFROM><BANKID>062000<ACCTID>12345678<ACCTTYPE>SAVINGS</BANKACCTFROM>
${statement}
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`),
  );
const august = depositOfx(`<BANKTRANLIST><DTSTART>20260801000000<DTEND>20260831235959
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260803<TRNAMT>-12.50<FITID>1001<MEMO>Bakery</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260810<TRNAMT>500.00<FITID>1002<MEMO>Salary</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>487.50<DTASOF>20260831140000</LEDGERBAL>`);
const earlySeptember = depositOfx(`<BANKTRANLIST><DTSTART>20260901000000<DTEND>20260915235959
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260905<TRNAMT>-20.00<FITID>1003<MEMO>Bakery</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>467.50<DTASOF>20260915140000</LEDGERBAL>`);

test(
  "an OFX for an unknown account asks which account while an account you added has no bank number",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const upload = yield* source(null, "ofx");
    const publication = yield* Publication;
    expect(yield* publication.publish({ ...(yield* august), importId: upload.importId })).toEqual({
      observations: 2,
      newPostings: 0,
      matchedPostings: 0,
      reviewItems: 1,
    });
    const accounts = yield* Accounts;
    expect(yield* accounts.list).toHaveLength(1);
    const reviews = yield* Reviews;
    const [review] = (yield* reviews.list()).rows;
    expect(review?.kind).toBe("account");
    if (!review) return yield* Effect.die("Expected the account review.");
    expect(review.question.message).toContain("the CommBank deposit account ending 5678");
    expect(
      yield* reviews.resolve({
        commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
        reviewItemId: review.id,
        expectedVersion: review.version,
        resolution: { kind: "account", accountId: owner.id },
      }),
    ).toEqual({ observations: 2, newPostings: 2, matchedPostings: 0, reviewItems: 0 });
    const owners = yield* accounts.list;
    expect(owners).toHaveLength(1);
    expect(owners[0]).toMatchObject({ id: owner.id, bankId: "062000", accountNumber: "12345678" });
    const postings = yield* Postings;
    expect((yield* postings.list({ filter: { accountId: owner.id } })).rows).toHaveLength(2);
  }).pipe(Effect.provide(services)),
);

test(
  "an OFX for an unknown account adds it when no account of its kind lacks a bank number",
  Effect.gen(function* () {
    yield* reset;
    const accounts = yield* Accounts;
    const card = yield* accounts.create({
      commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
      label: "Card",
      kind: "card",
      institution: "commbank",
      currency: "AUD",
    });
    const upload = yield* source(null, "ofx");
    const publication = yield* Publication;
    expect(yield* publication.publish({ ...(yield* august), importId: upload.importId })).toEqual({
      observations: 2,
      newPostings: 2,
      matchedPostings: 0,
      reviewItems: 0,
    });
    const added = (yield* accounts.list).filter((item) => item.id !== card.id);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      kind: "deposit",
      bankId: "062000",
      accountNumber: "12345678",
    });
  }).pipe(Effect.provide(services)),
);

test(
  "an OFX for a known account publishes to it while another account you added has no bank number",
  Effect.gen(function* () {
    yield* reset;
    const publication = yield* Publication;
    const first = yield* source(null, "ofx");
    yield* publication.publish({ ...(yield* august), importId: first.importId });
    const accounts = yield* Accounts;
    const [known] = yield* accounts.list;
    if (!known) return yield* Effect.die("Expected the account the OFX added.");
    const added = yield* account();
    const second = yield* source(null, "ofx");
    expect(
      yield* publication.publish({ ...(yield* earlySeptember), importId: second.importId }),
    ).toEqual({ observations: 1, newPostings: 1, matchedPostings: 0, reviewItems: 0 });
    const postings = yield* Postings;
    expect((yield* postings.list({ filter: { accountId: known.id } })).rows).toHaveLength(3);
    expect((yield* postings.list({ filter: { accountId: added.id } })).rows).toHaveLength(0);
  }).pipe(Effect.provide(services)),
);

// A deposit account's file that names its account, as an OFX envelope does.
const identified = (accountNumber: string, rows: Parameters<typeof parsedRows>[0]) =>
  ({
    ...parsedRows(rows),
    account: {
      institution: "commbank",
      bankId: "062000",
      accountNumber,
      kind: "deposit",
      currency: "AUD",
    },
  }) satisfies ParsedFile;
const toSavings = identified("12345678", [
  { description: "Transfer to xx9239 CommBank app", postedOn: "2026-08-05", minor: -10000n },
]);
const savings = identified("10009239", [
  { description: "Credit Interest", postedOn: "2026-08-31", minor: 150n },
]);
const publishIdentified = Effect.fn(function* (file: ParsedFile) {
  const upload = yield* source(null, "ofx");
  return yield* (yield* Publication).publish({ ...file, importId: upload.importId });
});
const augustTotals = Effect.gen(function* () {
  const flow = yield* (yield* Flows).period({
    period: { kind: "months", from: YearMonth.make("2026-08"), to: YearMonth.make("2026-08") },
    comparison: { kind: "previous" },
    basis: "posted",
    currency: "AUD",
  });
  return { outflow: flow.totals.outflow.minor, internal: flow.totals.internal.minor };
});
const openQuestionKinds = openQuestions.pipe(
  Effect.map((questions) => questions.map((question) => question.kind)),
);

test(
  "a transfer to an account that has no number yet is internal once the account's first file adds it",
  Effect.gen(function* () {
    yield* reset;
    yield* publishIdentified(toSavings);
    expect(yield* openQuestionKinds).toEqual(["ownAccount"]);
    expect(yield* augustTotals).toEqual({ outflow: 10000n, internal: 0n });
    yield* publishIdentified(savings);
    expect(yield* openQuestionKinds).toEqual([]);
    expect(yield* augustTotals).toEqual({ outflow: 0n, internal: 10000n });
  }).pipe(Effect.provide(services)),
);

test(
  "a transfer to an account you added is internal once you choose it for a file with its number",
  Effect.gen(function* () {
    yield* reset;
    yield* publishIdentified(toSavings);
    const added = yield* account();
    yield* publishIdentified(savings);
    const reviews = yield* Reviews;
    const [review] = (yield* reviews.list()).rows;
    if (review?.kind !== "account") return yield* Effect.die("Expected the account review.");
    expect(yield* openQuestionKinds).toEqual(["ownAccount"]);
    expect(yield* augustTotals).toEqual({ outflow: 10000n, internal: 0n });
    yield* reviews.resolve({
      commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
      reviewItemId: review.id,
      expectedVersion: review.version,
      resolution: { kind: "account", accountId: added.id },
    });
    expect(yield* openQuestionKinds).toEqual([]);
    expect(yield* augustTotals).toEqual({ outflow: 0n, internal: 10000n });
  }).pipe(Effect.provide(services)),
);
