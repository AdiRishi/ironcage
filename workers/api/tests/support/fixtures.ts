import { PgClient } from "@effect/sql-pg";
import {
  AccountId,
  CalendarDate,
  CommandId,
  ImportId,
  type ParsedFile,
  type SourceFormat,
  SourceFileId,
} from "@repo/contracts/finance";
import { Crypto, Effect } from "effect";

import { Accounts } from "../../src/accounts/service.ts";

export const reset = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  yield* sql`TRUNCATE rules, command_receipts, review_items, source_coverage, observations, postings, imports, source_files, accounts, exports, model_usage, counterparties, enrichment_runs, category_proposals CASCADE`;
  yield* sql`UPDATE enrichment_settings SET enabled = true, warning_minor = 2000, auto_apply_confidence = 0.8, version = 1 WHERE id = 1`;
});
export const account = Effect.fn("fixtureAccount")(function* () {
  const accounts = yield* Accounts;
  return yield* accounts.create({
    commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
    label: "Everyday",
    kind: "deposit",
    currency: "AUD",
  });
});
export const source = Effect.fn("fixtureSource")(function* (
  accountId: typeof AccountId.Type | null,
  format: typeof SourceFormat.Type = "csv",
) {
  const sql = yield* PgClient.PgClient;
  const sourceFileId = SourceFileId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4));
  const importId = ImportId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4));
  yield* sql`INSERT INTO source_files ${sql.insert({ id: sourceFileId, sha256: yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4), file_name: `example.${format}`, media_type: "text/plain", byte_size: 1, object_key: sourceFileId })}`;
  yield* sql`INSERT INTO imports ${sql.insert({ id: importId, source_file_id: sourceFileId, account_id: accountId, format, parser_version: "test", status: "processing" })}`;
  return { sourceFileId, importId };
});
export const parsed = (descriptions: ReadonlyArray<string>): ParsedFile => ({
  parserVersion: "test-1",
  account: null,
  statement: {
    statedStart: null,
    statedEnd: null,
    opening: null,
    closing: null,
    debitTotal: null,
    creditTotal: null,
    raw: {},
    order: "ascending",
  },
  observations: descriptions.map((description, index) => ({
    locatorKey: `csvLine:${index + 1}`,
    locator: { kind: "csvLine", line: index + 1 },
    raw: { date: "01/09/2026", amount: "-4.50", description, balance: "" },
    issue: null,
    candidate: {
      postedOn: CalendarDate.make("2026-09-01"),
      valueOn: null,
      amount: { currency: "AUD", minor: -450n },
      description,
      bankId: null,
      balance: null,
      originalMoney: null,
    },
  })),
});
export const parsedRows = (
  rows: ReadonlyArray<{ description: string; postedOn: string; minor: bigint }>,
): ParsedFile => ({
  ...parsed([]),
  observations: rows.map((row, index) => ({
    locatorKey: `csvLine:${index + 1}`,
    locator: { kind: "csvLine", line: index + 1 },
    raw: {
      date: row.postedOn,
      amount: row.minor.toString(),
      description: row.description,
      balance: "",
    },
    issue: null,
    candidate: {
      postedOn: CalendarDate.make(row.postedOn),
      valueOn: null,
      amount: { currency: "AUD", minor: row.minor },
      description: row.description,
      bankId: null,
      balance: null,
      originalMoney: null,
    },
  })),
});
