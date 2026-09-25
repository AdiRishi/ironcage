import { copyFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";

import { NodeServices } from "@effect/platform-node";
import { PgClient } from "@effect/sql-pg";
import {
  AllocationId,
  CalendarDate,
  CategoryId,
  CommandId,
  CounterpartyId,
  EventId,
  RuleId,
  type Account,
  type Rule,
  type FinancialEvent,
} from "@repo/contracts/finance";
import { applyMigrations, makePgMigrationExecutor } from "alchemy/SQL/Migrations/index";
import { Crypto, Effect, Schema } from "effect";
import { Client } from "pg";

import { Accounts } from "../../src/accounts/service.ts";
import { Corrections } from "../../src/events/corrections.ts";
import { Events } from "../../src/events/service.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Counterparties } from "../../src/interpretation/counterparties.ts";
import { Postings } from "../../src/postings/service.ts";
import { Relationships } from "../../src/relationships/service.ts";
import { Rules } from "../../src/rules/service.ts";
import { createCounterparty, parsedRows, reset, source } from "./fixtures.ts";

const migrationsDirectory = fileURLToPath(new URL("../../migrations/", import.meta.url));
export const migrationFiles = () =>
  readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql"))
    .toSorted();

// Applies migrations the way deployment does, optionally stopping after `through`.
export const migrate = Effect.fn("migrate")(
  function* (connectionString: string, through?: string) {
    const files = migrationFiles();
    const dir = through ? mkdtempSync(join(tmpdir(), "migrations-")) : migrationsDirectory;
    if (through)
      for (const name of files.slice(0, files.indexOf(through) + 1))
        copyFileSync(join(migrationsDirectory, name), join(dir, name));
    const client = yield* Effect.acquireRelease(
      Effect.promise(async () => {
        const connection = new Client({ connectionString });
        await connection.connect();
        return connection;
      }),
      (connection) => Effect.promise(() => connection.end()),
    );
    yield* applyMigrations({
      resolved: { dir, table: "__alchemy_migrations" },
      executor: makePgMigrationExecutor(client),
    });
  },
  Effect.scoped,
  Effect.provide(NodeServices.layer),
);

// A synthetic database captured at `migration`, used to test later migrations on data.
export const populatedFixture = new URL("../fixtures/populated.json", import.meta.url);
export const PopulatedFixture = Schema.Struct({
  migration: Schema.String,
  tables: Schema.Array(Schema.Struct({ name: Schema.String, rows: Schema.Array(Schema.Json) })),
});

const uuid = Crypto.Crypto.use((crypto) => crypto.randomUUIDv4);
const commandId = uuid.pipe(Effect.map((id) => CommandId.make(id)));

const createAccount = Effect.fn(function* (kind: Account["kind"], label: string) {
  const accounts = yield* Accounts;
  return yield* accounts.create({
    commandId: yield* commandId,
    kind,
    label,
    institution: "commbank",
    currency: "AUD",
  });
});

const publish = Effect.fn(function* (
  owner: Account,
  rows: ReadonlyArray<{ description: string; postedOn: string; minor: bigint }>,
) {
  const file = yield* source(owner.id);
  const publication = yield* Publication;
  yield* publication.publish({ ...parsedRows(rows), importId: file.importId });
  const postings = yield* Postings;
  const events = yield* Events;
  return yield* Effect.forEach(
    (yield* postings.list({ filter: { importId: file.importId } })).rows,
    (posting) =>
      Effect.gen(function* () {
        const event = yield* events.forPosting({ postingId: posting.id });
        if (!event) return yield* Effect.die("Expected an event for every posting");
        return event;
      }),
  );
});

const eventFor = (events: readonly FinancialEvent[], description: string) => {
  const event = events.find((row) => row.postings.some((p) => p.description === description));
  if (!event) throw new Error(`Expected a synthetic event for ${description}`);
  return event;
};

export const categoryId = Effect.fn(function* (slug: string) {
  const sql = yield* PgClient.PgClient;
  const [row] = yield* sql`SELECT id FROM categories WHERE slug = ${slug}`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: CategoryId })))),
  );
  if (!row) return yield* Effect.die(`Expected seeded category ${slug}`);
  return row.id;
});

// The active event whose primary posting has this description.
export const activeEvent = Effect.fn(function* (description: string) {
  const sql = yield* PgClient.PgClient;
  const [row] =
    yield* sql`SELECT e.id FROM events e JOIN postings p ON p.id = e.primary_posting_id WHERE e.active AND p.description = ${description}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: EventId })))),
    );
  if (!row) return yield* Effect.die(`Expected an event for ${description}`);
  return yield* (yield* Events).get({ eventId: row.id });
});

export const counterpartyNamed = Effect.fn(function* (name: string) {
  const sql = yield* PgClient.PgClient;
  const [row] = yield* sql`SELECT id FROM counterparties WHERE name = ${name}`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: CounterpartyId })))),
  );
  if (!row) return yield* Effect.die(`Expected a counterparty named ${name}`);
  return (yield* (yield* Counterparties).get({ counterpartyId: row.id })).counterparty;
});

// A synthetic history that reaches every kind of record a migration might rewrite:
// three account kinds, counterparties set by you, a rule, a split, a correction you
// undid, a credit link, and a card settlement.
export const populate = Effect.gen(function* () {
  yield* reset;
  const everyday = yield* createAccount("deposit", "Everyday");
  const card = yield* createAccount("card", "Card");
  const loan = yield* createAccount("loan", "Home loan");
  const deposits = yield* publish(everyday, [
    { description: "Salary ACME PTY LTD HR123456", postedOn: "2026-07-01", minor: 500000n },
    { description: "Transfer To Jane Smith NetBank Rent", postedOn: "2026-07-02", minor: -184000n },
    {
      description: "WOOLWORTHS 1234 SYDNEY AU Card xx1234",
      postedOn: "2026-07-03",
      minor: -8450n,
    },
    { description: "Dinner Place SYDNEY AU Card xx1234", postedOn: "2026-07-04", minor: -30000n },
    {
      description: "Fast Transfer From John Citizen dinner split",
      postedOn: "2026-07-06",
      minor: 20000n,
    },
    { description: "Transfer to xx9999 CommBank app Card", postedOn: "2026-07-20", minor: -12000n },
    { description: "Loan Repayment LN REPAY 123456789", postedOn: "2026-07-28", minor: -390000n },
    { description: "Refund Purchase MYER SYDNEY", postedOn: "2026-08-02", minor: 4000n },
    { description: "MYER SYDNEY AU Card xx1234", postedOn: "2026-07-15", minor: -12000n },
  ]);
  const cards = yield* publish(card, [
    { description: "BIG SHOP SYDNEY AU", postedOn: "2026-07-10", minor: -12000n },
    { description: "Payment Received, Thank You", postedOn: "2026-07-21", minor: 12000n },
  ]);
  yield* publish(loan, [
    { description: "Interest charged", postedOn: "2026-07-27", minor: -280000n },
    { description: "Loan Repayment", postedOn: "2026-07-28", minor: 390000n },
  ]);

  yield* createCounterparty(
    {
      name: "Jane Smith",
      kind: "person",
      defaultCategoryId: yield* categoryId("housing.rent"),
      defaultRole: "purchase",
    },
    ["JANE SMITH"],
  );
  yield* createCounterparty(
    { name: "Woolworths", defaultCategoryId: yield* categoryId("food.groceries") },
    ["WOOLWORTHS SYDNEY"],
  );
  yield* createCounterparty(
    {
      name: "John Citizen",
      kind: "person",
      defaultCategoryId: yield* categoryId("food.dining-out"),
      defaultRole: "reimbursement",
    },
    ["JOHN CITIZEN"],
  );

  const rules = yield* Rules;
  const dining = yield* categoryId("food.dining-out");
  const rule: Rule = {
    id: RuleId.make(yield* uuid),
    name: "Dinner place",
    conditions: {
      accountId: null,
      role: null,
      counterpartyId: null,
      channel: null,
      description: "Dinner Place",
    },
    action: { kind: "category", categoryId: dining },
    scope: "both",
    version: 1,
  };
  const rulePreview = yield* rules.preview({ rule, exceptionEventIds: [] });
  yield* rules.save({
    rule,
    exceptionEventIds: [],
    commandId: yield* commandId,
    expectedVersion: null,
    expectedVersions: rulePreview.expectedVersions,
  });

  const events = yield* Events;
  const corrections = yield* Corrections;
  const big = yield* events.get({ eventId: eventFor(cards, "BIG SHOP SYDNEY AU").id });
  const [whole] = big.allocations;
  if (!whole) return yield* Effect.die("Expected an allocation");
  yield* corrections.apply({
    commandId: yield* commandId,
    expectedVersions: [{ eventId: big.id, version: big.version }],
    change: {
      eventId: big.id,
      kind: "purchase",
      purchaseOn: CalendarDate.make("2026-07-09"),
      allocations: [
        {
          ...whole,
          role: "purchase",
          categoryId: yield* categoryId("shopping.clothing"),
          amount: { currency: "AUD", minor: 8000n },
        },
        {
          ...whole,
          id: AllocationId.make(yield* uuid),
          role: "purchase",
          categoryId: yield* categoryId("shopping.home"),
          amount: { currency: "AUD", minor: 4000n },
        },
      ],
    },
  });

  const salary = yield* events.get({
    eventId: eventFor(deposits, "Salary ACME PTY LTD HR123456").id,
  });
  const [pay] = salary.allocations;
  const categorised = yield* corrections.apply({
    commandId: yield* commandId,
    expectedVersions: [{ eventId: salary.id, version: salary.version }],
    change: {
      eventId: salary.id,
      kind: salary.kind,
      purchaseOn: null,
      allocations: [{ ...pay, categoryId: yield* categoryId("income-salary") }],
    },
  });
  const [correction] = (yield* corrections.history({ eventId: salary.id })).entries;
  if (correction?.kind !== "correction") return yield* Effect.die("Expected the salary correction");
  yield* corrections.undo({
    commandId: yield* commandId,
    correctionId: correction.correction.id,
    expectedVersions: [{ eventId: salary.id, version: categorised.version }],
  });

  const relationships = yield* Relationships;
  const link = Effect.fn(function* (
    change: Parameters<(typeof relationships)["preview"]>[0]["change"],
  ) {
    const preview = yield* relationships.preview({ change });
    yield* relationships.apply({
      commandId: yield* commandId,
      change,
      expectedVersions: preview.expectedVersions,
    });
  });
  const dinner = yield* events.get({
    eventId: eventFor(deposits, "Dinner Place SYDNEY AU Card xx1234").id,
  });
  const repaid = yield* events.get({
    eventId: eventFor(deposits, "Fast Transfer From John Citizen dinner split").id,
  });
  const [cost] = dinner.allocations;
  const [credit] = repaid.allocations;
  if (!cost || !credit) return yield* Effect.die("Expected allocations");
  yield* link({
    kind: "linkCredit",
    creditAllocationId: credit.id,
    costAllocationId: cost.id,
    amount: { currency: "AUD", minor: 20000n },
  });
  yield* link({
    kind: "linkMovement",
    eventId: eventFor(deposits, "Transfer to xx9999 CommBank app Card").id,
    movementKind: "cardSettlement",
    counterpart: { kind: "event", eventId: eventFor(cards, "Payment Received, Thank You").id },
  });
});

// Every base table except the migration log, read as JSON so the fixture replays into
// the same schema without pg_dump.
export const dumpTables = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const names = yield* sql`SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name NOT LIKE '\\_\\_%'
      ORDER BY table_name`.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ name: Schema.String }))),
    ),
  );
  return yield* Effect.forEach(names, ({ name }) =>
    sql`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) AS rows FROM ${sql(name)} t`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Tuple([Schema.Struct({ rows: Schema.Array(Schema.Json) })]),
        ),
      ),
      Effect.map(([table]) => ({ name, rows: table.rows })),
    ),
  );
});

// Replaces every table's rows with the fixture's. Replica mode skips foreign keys and
// triggers so rows load in any order and nothing derives from them on the way in.
export const loadTables = Effect.fn("loadTables")(function* (
  tables: (typeof PopulatedFixture.Type)["tables"],
) {
  const sql = yield* PgClient.PgClient;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`SET LOCAL session_replication_role = replica`;
      for (const table of tables) {
        yield* sql`DELETE FROM ${sql(table.name)}`;
        if (table.rows.length > 0)
          yield* sql`INSERT INTO ${sql(table.name)} SELECT * FROM jsonb_populate_recordset(NULL::${sql(table.name)}, ${sql.json(table.rows)})`;
      }
    }),
  );
});
