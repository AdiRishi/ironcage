import { readFileSync } from "node:fs";

import { PgClient } from "@effect/sql-pg";
import { CalendarDate } from "@repo/contracts/finance";
import { Effect, Layer, Redacted, Schema } from "effect";
import { expect } from "vitest";

import { Flows } from "../../src/analysis/flows.ts";
import { FactRebuilds } from "../../src/analysis/rebuild.ts";
import { applicationServices, applicationTest } from "../support/application.ts";
import {
  PopulatedFixture,
  loadTables,
  migrate,
  migrationFiles,
  populatedFixture,
} from "../support/populated.ts";

const { test, stack } = applicationTest();
const database = `populated_${crypto.randomUUID().slice(0, 8)}`;

const connect = (name: string) =>
  Layer.unwrap(
    Effect.map(stack, ({ port }) =>
      PgClient.layer({
        host: "127.0.0.1",
        port,
        username: "ironcage",
        database: name,
        password: Redacted.make("local-development"),
      }),
    ),
  );

test(
  "every later migration applies to a populated database and keeps its money",
  Effect.gen(function* () {
    const fixture = yield* Schema.decodeEffect(Schema.fromJsonString(PopulatedFixture))(
      readFileSync(populatedFixture, "utf8"),
    );
    const admin = (statement: string) =>
      Effect.flatMap(PgClient.PgClient, (sql) => sql.unsafe(statement)).pipe(
        Effect.provide(connect("ironcage")),
      );
    yield* admin(`CREATE DATABASE ${database}`);
    const services = applicationServices(connect(database));
    yield* Effect.gen(function* () {
      expect(migrationFiles()).toContain(fixture.migration);
      const { port } = yield* stack;
      const url = `postgres://ironcage:local-development@127.0.0.1:${port}/${database}`;
      yield* migrate(url, fixture.migration);
      yield* loadTables(fixture.tables);
      yield* migrate(url);

      const sql = yield* PgClient.PgClient;
      const [postings] =
        yield* sql`SELECT count(*)::int AS count, sum(amount_minor)::text AS total FROM postings`.pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Tuple([Schema.Struct({ count: Schema.Int, total: Schema.String })]),
            ),
          ),
        );
      expect(postings).toEqual({ count: 13, total: "-2450" });
      const unbalanced =
        yield* sql`SELECT e.id FROM events e JOIN allocations a ON a.event_id = e.id WHERE e.active
          GROUP BY e.id, e.magnitude_minor HAVING sum(a.amount_minor) <> e.magnitude_minor`;
      expect(unbalanced).toEqual([]);
      // The fixture's 13 facts name their event's primary posting until the rebuild.
      const [backfilled] =
        yield* sql`SELECT count(*)::int AS count FROM ledger_facts f JOIN events e ON e.id = f.event_id
          WHERE f.posting_id = e.primary_posting_id AND f.credit_event_id IS NULL`.pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ count: Schema.Int })])),
          ),
        );
      expect(backfilled.count).toBe(13);

      // July's spending, counted by hand from the fixture: rent 1,840.00, groceries
      // 84.50, dinner 300.00 less the 200.00 linked repayment, two 120.00 purchases,
      // and 2,800.00 loan interest.
      const rebuilds = yield* FactRebuilds;
      expect(yield* rebuilds.rebuild).toBe(0);
      const flows = yield* Flows;
      const july = yield* flows.period({
        period: {
          kind: "fixed",
          start: CalendarDate.make("2026-07-01"),
          endExclusive: CalendarDate.make("2026-08-01"),
        },
        comparison: { kind: "previous" },
        basis: "spending",
        currency: "AUD",
      });
      expect(july.totals.spending.minor).toBe(506450n);
      expect(july.totals.income.minor).toBe(500000n);
    }).pipe(Effect.provide(services));
    yield* admin(`DROP DATABASE ${database} WITH (FORCE)`);
  }),
  120_000,
);
