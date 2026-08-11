import { describe, expect, it } from "vitest";

import { invalidatedBy } from "@/data/invalidation";
import { keys } from "@/data/keys";

describe("invalidatedBy", () => {
  it("makes every money read stale when an import lands", () => {
    expect(invalidatedBy("bank_import_completed")).toContainEqual(keys.money());
  });

  it("covers analysis, balances, the review queue, and history under one prefix", () => {
    const money = keys.money();

    for (const key of [
      keys.moneyAnalysis("2026-01" as never, "2026-03" as never),
      keys.moneyBalances(),
      keys.moneyReview(),
      keys.moneyImportHistory(),
    ]) {
      expect(key.slice(0, money.length)).toEqual(money);
    }
  });

  it("leaves money alone for an event that cannot change it", () => {
    expect(invalidatedBy("ai_run_failed")).not.toContainEqual(keys.money());
  });
});
