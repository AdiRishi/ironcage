import { PgClient } from "@effect/sql-pg";
import {
  AccountId,
  CalendarDate,
  CommandId,
  type Counterparty,
  type CounterpartyFields,
  type EnrichmentResult,
  ImportId,
  type ParsedFile,
  type SourceFormat,
  SourceFileId,
} from "@repo/contracts/finance";
import { Crypto, Effect, Struct } from "effect";

import { Accounts } from "../../src/accounts/service.ts";
import { Counterparties } from "../../src/interpretation/counterparties.ts";
import { Enrichment } from "../../src/interpretation/enrichment.ts";
import { Questions } from "../../src/interpretation/questions.ts";

export const reset = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  yield* sql`TRUNCATE rules, command_receipts, review_items, source_coverage, observations, postings, imports, source_files, accounts, exports, model_usage, counterparties, counterparty_changes, enrichment_runs, category_proposals CASCADE`;
  yield* sql`UPDATE enrichment_settings SET enabled = true, warning_minor = 2000, auto_apply_confidence = 0.8, version = 1 WHERE id = 1`;
});
// The open questions in AUD, when they fit on one page.
export const openQuestions = Effect.gen(function* () {
  const page = yield* (yield* Questions).list({
    currency: "AUD",
    filter: null,
    period: null,
    cursor: null,
  });
  return page.rows;
});
export const account = Effect.fn("fixtureAccount")(function* () {
  const accounts = yield* Accounts;
  return yield* accounts.create({
    commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
    label: "Everyday",
    kind: "deposit",
    institution: "commbank",
    currency: "AUD",
  });
});
// A counterparty you created, claiming descriptors that no counterparty holds yet.
export const createCounterparty = Effect.fn("fixtureCounterparty")(function* (
  fields: Pick<typeof CounterpartyFields.Type, "name"> & Partial<typeof CounterpartyFields.Type>,
  aliasKeys: readonly string[],
) {
  const { counterparty } = yield* (yield* Counterparties).apply({
    commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
    change: {
      kind: "create",
      fields: {
        kind: "business",
        brand: null,
        defaultCategoryId: null,
        defaultRole: null,
        ...fields,
      },
      aliases: aliasKeys.map((aliasKey) => ({ aliasKey, expectedVersion: null })),
    },
  });
  return counterparty;
});
// Saves new fields for a counterparty at the version it was read.
export const updateCounterparty = Effect.fn("fixtureCounterpartyUpdate")(function* (
  counterparty: Counterparty,
  fields: Partial<typeof CounterpartyFields.Type>,
) {
  const outcome = yield* (yield* Counterparties).apply({
    commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
    change: {
      kind: "update",
      counterpartyId: counterparty.id,
      expectedVersion: counterparty.version,
      fields: {
        ...Struct.pick(counterparty, ["name", "kind", "brand", "defaultCategoryId", "defaultRole"]),
        ...fields,
      },
    },
  });
  return outcome.counterparty;
});
// Runs enrichment over every descriptor without a counterparty and applies these answers
// from the model. Each is a business named with high confidence unless it says otherwise.
export const enrich = Effect.fn("fixtureEnrichment")(function* (
  answers: readonly (Partial<EnrichmentResult> & Pick<EnrichmentResult, "aliasKey" | "name">)[],
) {
  const enrichment = yield* Enrichment;
  const commandId = Crypto.Crypto.use((crypto) => crypto.randomUUIDv4).pipe(
    Effect.map((id) => CommandId.make(id)),
  );
  const run = yield* enrichment.request({ commandId: yield* commandId });
  const batch = yield* enrichment.batch({ runId: run.id });
  yield* enrichment.complete({
    commandId: yield* commandId,
    runId: run.id,
    aliasKeys: batch.aliases.map((alias) => alias.aliasKey),
    report: {
      status: "success",
      results: answers.map((fields) => ({
        existingCounterpartyId: null,
        kind: "business",
        brand: null,
        categoryKey: null,
        defaultRole: null,
        confidence: 0.95,
        reason: "Synthetic reason.",
        proposedSubcategory: null,
        ...fields,
      })),
      inputTokens: 1000n,
      outputTokens: 200n,
      cost: { currency: "USD", minor: 2n },
      failure: null,
    },
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
  yield* sql`INSERT INTO imports ${sql.insert({ id: importId, source_file_id: sourceFileId, account_id: accountId, format, institution: "commbank", parser_version: "test", status: "processing" })}`;
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
