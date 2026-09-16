import { PgClient } from "@effect/sql-pg";
import { CalendarDate, type OverviewInput } from "@repo/contracts/finance";
import { CommandId } from "@repo/contracts/finance";
import { Crypto, Effect } from "effect";
import { expect } from "vitest";

import { Analysis } from "../../src/analysis/service.ts";
import { Events } from "../../src/events/service.ts";
import { Publication } from "../../src/imports/publication.ts";
import { applicationTest } from "../support/application.ts";
import { account, source, parsed, reset } from "../support/fixtures.ts";
const { test, services } = applicationTest();
test(
  "overview distinguishes recorded costs from missing coverage and preserves exact money",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const file = yield* source(owner.id);
    const publication = yield* Publication;
    yield* publication.publish({
      ...parsed(["Grocer Card xx1234", "Account Fee", "Unknown debit"]),
      importId: file.importId,
    });
    const events = yield* Events;
    yield* events.interpret({
      commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
      scope: "all",
    });
    const analysis = yield* Analysis;
    const input: OverviewInput = {
      period: {
        kind: "fixed",
        start: CalendarDate.make("2026-09-01"),
        endExclusive: CalendarDate.make("2026-10-01"),
      },
      basis: "spending",
      currency: "AUD",
      accounts: [owner.id],
    };
    const result = yield* analysis.overview(input);
    expect(result.grossCosts.minor).toBe(900n);
    expect(result.netPersonalCosts.minor).toBe(900n);
    expect(result.income.minor).toBe(0n);
    expect(result.surplus.minor).toBe(-900n);
    expect(result.surplusRate).toBeNull();
    expect(result.cashBalanceChange).toBeNull();
    expect(result.purchaseCount).toBe(1);
    expect(result.coverage.unresolvedCount).toBe(1);
    expect(result.coverage.unresolvedAmount.minor).toBe(450n);
    expect(result.coverage.accounts[0]?.missing).toEqual([
      { start: "2026-09-01", endExclusive: "2026-10-01" },
    ]);
    const sql = yield* PgClient.PgClient;
    yield* sql`UPDATE source_coverage SET opening_on='2026-09-01',closing_on='2026-09-30',opening_minor=10000,closing_minor=8650,reconciled=true WHERE source_file_id=${file.sourceFileId}`;
    const covered = yield* analysis.overview(input);
    expect(covered.cashBalanceChange?.minor).toBe(-1350n);
    expect(covered.coverage.accounts[0]?.missing).toEqual([]);
  }).pipe(Effect.provide(services)),
);
