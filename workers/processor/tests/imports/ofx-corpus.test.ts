import { existsSync, readdirSync, readFileSync } from "node:fs";
import { URL } from "node:url";

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { parseCsv } from "../../src/imports/csv.ts";
import { parseOfx } from "../../src/imports/ofx.ts";
const directory = new URL("../../../../fixtures/commbank/", import.meta.url);
describe.skipIf(!existsSync(directory))("private OFX corpus", () => {
  it.effect(
    "every OFX has its CSV's booked fields and retains the later ledger snapshot",
    () =>
      Effect.gen(function* () {
        const names = readdirSync(directory).filter((name) => name.endsWith(".ofx"));
        const identities = new Set<string>();
        let count = 0;
        let differingBalances = 0;
        for (const name of names) {
          const parsed = yield* parseOfx(readFileSync(new URL(name, directory)));
          const csvName = name.replace(/^(\d+)b_/, "$1a_").replace(/\.ofx$/, ".csv");
          const csv = yield* parseCsv(readFileSync(new URL(csvName, directory)), "AUD");
          expect(parsed.observations.length === csv.observations.length).toBe(true);
          const sameRows = parsed.observations.every((row, index) => {
            const other = csv.observations[index]?.candidate;
            return (
              row.candidate !== null &&
              other !== undefined &&
              other !== null &&
              row.candidate?.postedOn === other.postedOn &&
              row.candidate?.amount.minor === other.amount.minor &&
              row.candidate?.description === other.description &&
              row.candidate?.valueOn === other.valueOn
            );
          });
          expect(sameRows).toBe(true);
          const newestBalance = csv.observations[0]?.candidate?.balance;
          if (newestBalance && parsed.statement.closing.money.minor !== newestBalance.minor)
            differingBalances++;
          const newestDate = parsed.observations[0]?.candidate?.postedOn;
          expect(newestDate !== undefined && parsed.statement.closing.on > newestDate).toBe(true);
          identities.add(`${parsed.account.bankId}/${parsed.account.accountNumber}`);
          count += parsed.observations.length;
        }
        expect(count).toBe(3031);
        expect(differingBalances).toBe(21);
        expect(identities.size).toBe(4);
      }),
    { timeout: 30_000 },
  );
});
