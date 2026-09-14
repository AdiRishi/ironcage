import { existsSync, readdirSync, readFileSync } from "node:fs";
import { URL } from "node:url";

import { describe, expect, it } from "@effect/vitest";
import { reconcile } from "@repo/finance";
import { Effect } from "effect";

import { parseCsv } from "../../src/imports/csv.ts";

const directory = new URL("../../../../fixtures/commbank/", import.meta.url);
describe.skipIf(!existsSync(directory))("private CSV corpus", () => {
  it.effect("every private CSV parses independently with reconciled running balances", () =>
    Effect.gen(function* () {
      const files = readdirSync(directory).filter((name) => name.endsWith(".csv"));
      let count = 0;
      let balanced = 0;
      for (const file of files) {
        const parsed = yield* parseCsv(readFileSync(new URL(file, directory)), "AUD");
        count += parsed.observations.length;
        const coverage = reconcile(parsed);
        expect(coverage.issues).toEqual([]);
        if (parsed.observations.some((row) => row.candidate?.balance)) {
          expect(coverage.reconciled).toBe(true);
          balanced++;
        }
      }
      expect(files).toHaveLength(26);
      expect(count).toBe(3031);
      expect(balanced).toBeGreaterThan(0);
    }),
  );
});
