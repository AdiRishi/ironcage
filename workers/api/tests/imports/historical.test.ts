import { existsSync, readdirSync, readFileSync } from "node:fs";
import { URL } from "node:url";

import { PgClient } from "@effect/sql-pg";
import { CommandId, type ParsedFile, type SourceFormat } from "@repo/contracts/finance";
import { parseCsv, parseOfx, parsePdf } from "@repo/processor/imports";
import { Crypto, Effect, Schema } from "effect";
import { expect } from "vitest";

import { Accounts } from "../../src/accounts/service.ts";
import { Publication } from "../../src/imports/publication.ts";
import { applicationTest } from "../support/application.ts";
import { reset, source } from "../support/fixtures.ts";

const { test, services } = applicationTest();
const directory = new URL("../../../../fixtures/commbank/", import.meta.url);
test.skipIf(!existsSync(directory))(
  "the full historical corpus preserves booked transactions in both file orders",
  Effect.gen(function* () {
    const names = readdirSync(directory)
      .filter((name) => /\.(csv|ofx|pdf)$/.test(name))
      .sort();
    const files = new Map<
      string,
      { file: ParsedFile; format: typeof SourceFormat.Type; identity: string }
    >();
    for (const name of names.filter((name) => name.endsWith(".ofx"))) {
      const ofx = yield* parseOfx(new Uint8Array(readFileSync(new URL(name, directory))));
      if (!ofx.account) return yield* Effect.die("Missing corpus bank identity.");
      const csvName = name.replace(/b_(.*)\.ofx$/, "a_$1.csv");
      const csv = yield* parseCsv(new Uint8Array(readFileSync(new URL(csvName, directory))), "AUD");
      files.set(name, { file: ofx, format: "ofx", identity: ofx.account.accountNumber });
      files.set(csvName, { file: csv, format: "csv", identity: ofx.account.accountNumber });
    }
    for (const name of names.filter((name) => name.endsWith(".pdf"))) {
      const file = yield* parsePdf(new Uint8Array(readFileSync(new URL(name, directory))));
      if (!file.account) return yield* Effect.die("Missing statement bank identity.");
      files.set(name, { file, format: "pdf", identity: file.account.accountNumber });
    }
    expect(files.size).toBe(99);
    const accounts = yield* Accounts;
    const publication = yield* Publication;
    const sql = yield* PgClient.PgClient;
    let baseline: ReadonlyArray<string> | undefined;
    for (const reverse of [false, true]) {
      yield* reset;
      const owners = new Map<string, Effect.Success<ReturnType<typeof accounts.create>>>();
      for (const { file, identity } of files.values()) {
        if (owners.has(identity) || !file.account) continue;
        owners.set(
          identity,
          yield* accounts.create({
            commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
            label: `Corpus account ${owners.size + 1}`,
            kind: file.account.kind,
            currency: file.account.currency,
          }),
        );
      }
      for (const name of reverse ? names.toReversed() : names) {
        const parsed = files.get(name);
        if (!parsed) return yield* Effect.die("Missing corpus file.");
        const owner = owners.get(parsed.identity);
        if (!owner) return yield* Effect.die("Missing corpus account.");
        const imported = yield* source(owner.id, parsed.format);
        yield* publication.publish({ importId: imported.importId, ...parsed.file });
      }
      const questions =
        yield* sql`SELECT r.kind, i.format, r.question->>'reason' AS reason, cardinality(r.observation_ids) AS rows, jsonb_array_length(r.candidates) AS candidates, count(*)::integer AS count FROM review_items r JOIN imports i ON i.id = r.import_id WHERE r.resolved_at IS NULL GROUP BY r.kind, i.format, r.question->>'reason', cardinality(r.observation_ids), jsonb_array_length(r.candidates) ORDER BY r.kind, i.format, reason, rows, candidates`;
      const counts =
        yield* sql`SELECT (SELECT count(*)::integer FROM postings) AS postings, (SELECT count(*)::integer FROM observations) AS observations, (SELECT count(*)::integer FROM source_coverage WHERE reconciled) AS reconciled`;
      const unresolvedKeys =
        yield* sql`SELECT count(DISTINCT (i.account_id, o.parsed_candidate->>'postedOn', o.parsed_candidate->'amount'->>'minor'))::integer AS count FROM review_items r JOIN imports i ON i.id = r.import_id JOIN observations o ON o.id = ANY(r.observation_ids) WHERE r.resolved_at IS NULL`;
      expect(questions).toEqual(
        reverse
          ? [
              {
                kind: "duplicate",
                format: "ofx",
                reason: "ambiguousGroup",
                rows: 2,
                candidates: 2,
                count: 6,
              },
            ]
          : [],
      );
      expect(unresolvedKeys).toEqual([{ count: reverse ? 6 : 0 }]);
      expect(counts).toEqual([{ postings: 9224, observations: 15334, reconciled: 72 }]);
      const canonical =
        yield* sql`SELECT a.account_number || '/' || p.posted_on::text || '/' || p.currency || '/' || p.amount_minor::text AS signature FROM postings p JOIN accounts a ON a.id = p.account_id ORDER BY signature`.pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ signature: Schema.String }))),
          ),
          Effect.map((rows) => rows.map((row) => row.signature)),
        );
      expect(canonical).toHaveLength(9224);
      if (baseline) expect(JSON.stringify(canonical) === JSON.stringify(baseline)).toBe(true);
      baseline = canonical;
    }
  }).pipe(Effect.provide(services)),
  { timeout: 300_000 },
);
