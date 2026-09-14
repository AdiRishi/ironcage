import { existsSync, readdirSync, readFileSync } from "node:fs";
import { URL } from "node:url";

import { PgClient } from "@effect/sql-pg";
import { CommandId, FinanceError, ImportSummary, ResolveReview } from "@repo/contracts/finance";
import { Console, Duration, Effect, Schema } from "effect";
import { expect } from "vitest";

import { parseCsv } from "../../../processor/src/imports/csv.ts";
import { parseOfx } from "../../../processor/src/imports/ofx.ts";
import { Accounts } from "../../src/accounts/service.ts";
import { Commands } from "../../src/database/commands.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Postings } from "../../src/postings/service.ts";
import { Reviews } from "../../src/review/service.ts";
import { applicationTest } from "../support/application.ts";
import { account, parsed, reset, source } from "../support/fixtures.ts";

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
    const [review] = yield* reviews.list();
    expect(review?.kind).toBe("duplicate");
    expect(review?.candidates).toHaveLength(2);
    if (!review?.observations[0] || !review.candidates[0])
      return yield* Effect.die("Expected a review with choices.");
    const command: typeof ResolveReview.Type = {
      commandId: CommandId.make(crypto.randomUUID()),
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
    expect(yield* reviews.list()).toHaveLength(0);
    const stale = yield* reviews
      .resolve({ ...command, commandId: CommandId.make(crypto.randomUUID()) })
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
    const [review] = yield* reviews.list();
    const row = review?.observations[0];
    if (!review || !row?.acceptedCandidate || !row.postingId)
      return yield* Effect.die("Expected the prior accepted source row.");
    expect(review.kind).toBe("source_conflict");
    yield* reviews.resolve({
      commandId: CommandId.make(crypto.randomUUID()),
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
    expect(yield* reviews.list()).toHaveLength(0);
    expect((yield* postings.list({ filter: {} })).rows[0]?.description).toBe("Coffee");
  }).pipe(Effect.provide(services)),
);

test(
  "a failed command rolls back its writes and can retry with the same command ID",
  Effect.gen(function* () {
    yield* reset;
    const commands = yield* Commands;
    const sql = yield* PgClient.PgClient;
    const commandId = CommandId.make(crypto.randomUUID());
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
          yield* sql`INSERT INTO accounts (id, kind, label, currency) VALUES (${crypto.randomUUID()}, 'deposit', 'Uncommitted', 'AUD')`;
          return yield* new FinanceError({
            kind: "unavailable",
            message: "Injected failure before commit.",
          });
        }),
      })
      .pipe(Effect.flip);
    expect(failed.kind).toBe("unavailable");
    const accounts = yield* Accounts;
    expect(yield* accounts.list()).toHaveLength(0);
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
              commandId: CommandId.make(crypto.randomUUID()),
              label: `Corpus account ${owners.size + 1}`,
              kind: pair.identity.kind,
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
      expect(yield* reviews.list()).toHaveLength(0);
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
    const [review] = yield* reviews.list();
    const row = review?.observations[0];
    if (!review || !row) return yield* Effect.die("Expected the unreadable source row.");
    const correction = parsed(["Coffee"]).observations[0]?.candidate;
    if (!correction) return yield* Effect.die("Expected a decoded correction.");
    yield* reviews.resolve({
      commandId: CommandId.make(crypto.randomUUID()),
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
    expect(yield* reviews.list()).toHaveLength(0);
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
    const [review] = yield* reviews.list();
    const choice = review?.candidates[0];
    const firstRow = review?.observations[0];
    const secondRow = review?.observations[1];
    if (!review || !choice || !firstRow || !secondRow)
      return yield* Effect.die("Expected two ambiguous rows.");
    const failure = yield* reviews
      .resolve({
        commandId: CommandId.make(crypto.randomUUID()),
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
    expect(yield* reviews.list()).toHaveLength(1);
  }).pipe(Effect.provide(services)),
);
