import { existsSync, readdirSync, readFileSync } from "node:fs";
import { URL } from "node:url";

import { describe, expect, it } from "@effect/vitest";
import { reconcile } from "@repo/finance";
import { Effect } from "effect";

import { parsePdf } from "../../src/imports/pdf/index.ts";

const directory = new URL("../../../../fixtures/commbank/", import.meta.url);
describe.skipIf(!existsSync(directory))("private PDF corpus", () => {
  it.effect(
    "every statement reconciles its printed balances and totals with no unreadable transaction",
    () =>
      Effect.gen(function* () {
        const files = readdirSync(directory)
          .filter((name) => name.endsWith(".pdf"))
          .sort();
        let transactions = 0;
        let notices = 0;
        for (const name of files) {
          const parsed = yield* parsePdf(new Uint8Array(readFileSync(new URL(name, directory))));
          expect(parsed.account !== null).toBe(true);
          expect(parsed.statement.opening !== null && parsed.statement.closing !== null).toBe(true);
          expect(parsed.observations.some((row) => row.issue !== null)).toBe(false);
          expect(reconcile(parsed).reconciled).toBe(true);
          transactions += parsed.observations.filter((row) => row.candidate !== null).length;
          notices += parsed.observations.filter((row) => row.candidate === null).length;
        }
        expect(files).toHaveLength(47);
        expect(transactions).toBe(9159);
        expect(notices).toBe(113);
      }),
    { timeout: 120_000 },
  );
});
