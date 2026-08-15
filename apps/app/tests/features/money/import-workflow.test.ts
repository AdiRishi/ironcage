import { BankAccountId } from "@ironcage/domain";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  initialImportWorkflow,
  reduceImportWorkflow,
  selectedImportSource,
} from "@/features/money/import-workflow";

const accountId = Schema.decodeUnknownSync(BankAccountId)("01900000-0000-7000-8000-000000000001");

describe("bank import workflow", () => {
  it("preserves the account and discards incompatible files when the source mode changes", () => {
    const csv = new File(["csv"], "transactions.csv");
    const ofx = new File(["ofx"], "transactions.ofx");
    const accountSelected = reduceImportWorkflow(initialImportWorkflow, {
      type: "selectAccount",
      accountId,
    });
    const csvSelected = reduceImportWorkflow(accountSelected, { type: "selectCsv", file: csv });
    const selected = reduceImportWorkflow(csvSelected, { type: "selectOfx", file: ofx });

    expect(selected.stage).toBe("select");
    if (selected.stage !== "select") return;
    expect(selectedImportSource(selected.selection)).toEqual({
      kind: "commbank_structured",
      accountId,
      csv,
      ofx,
    });

    const statement = reduceImportWorkflow(selected, { type: "selectMode", mode: "statement" });
    expect(statement).toEqual({
      stage: "select",
      selection: { mode: "statement", accountId, pdf: null },
    });
    if (statement.stage !== "select") return;
    expect(selectedImportSource(statement.selection)).toBeNull();
  });

  it("keeps the refresh notice through the replacement preview", () => {
    const pdf = new File(["pdf"], "statement.pdf");
    const source = { kind: "commbank_statement", accountId, pdf } as const;
    const preview = reduceImportWorkflow(initialImportWorkflow, { type: "previewed", source });
    const refreshing = reduceImportWorkflow(preview, { type: "refreshing" });
    const refreshed = reduceImportWorkflow(refreshing, { type: "previewed", source });

    expect(refreshed).toEqual({ stage: "preview", source, refreshed: true });
    expect(reduceImportWorkflow(refreshed, { type: "reset" })).toBe(initialImportWorkflow);
  });
});
