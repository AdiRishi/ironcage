import { BigDecimal, Effect } from "effect";
import { describe, expect, test } from "vitest";

import type { BankImportBlocked } from "../../src/money/import/block";
import { parseOffsetStatement } from "../../src/money/import/statement";
import statementBytes from "../fixtures/money/commbank/statement/offset-statement-a.md?bytes";

const markdown = () => new TextDecoder().decode(statementBytes);

const parse = (text: string) => Effect.runSync(parseOffsetStatement(text));
const block = (text: string): BankImportBlocked =>
  Effect.runSync(Effect.flip(parseOffsetStatement(text)));

const format = (value: BigDecimal.BigDecimal) => BigDecimal.format(BigDecimal.normalize(value));

// The fixture reproduces every observed extraction pathology: a prose-form
// first page, Markdown tables with continuation rows, a salary row whose
// amount surfaces later as a stray block, separated column dumps, print
// artifacts fused onto a transaction day, and the sentinel and totals lines.
describe("the offset statement profile", () => {
  test("reconstructs rows across every page shape and reconciles", () => {
    const statement = parse(markdown());

    expect(statement.accountNumber).toBe("99 9999 10000001");
    expect(statement.period).toEqual({ start: "2032-03-25", end: "2032-06-24" });
    expect(statement.rows).toHaveLength(11);
    expect(format(statement.opening)).toBe("10000");
    expect(format(statement.closing)).toBe("13469.21");
    expect(format(statement.totalDebits)).toBe("1550.79");
    expect(format(statement.totalCredits)).toBe("5020");

    const salary = statement.rows[3]!;
    expect(salary.postedDate).toBe("2032-04-02");
    expect(format(salary.amount)).toBe("5000");
    expect(salary.narrative).toContain("Salary EMPLOYER PTY LT");

    const refund = statement.rows[6]!;
    expect(format(refund.amount)).toBe("20");

    const fusedDay = statement.rows[9]!;
    expect(fusedDay.postedDate).toBe("2032-05-20");
    expect(fusedDay.narrative).toContain("Wdl ATM");

    // The chain holds row over row from the opening balance.
    let running = statement.opening;
    for (const row of statement.rows) {
      running = BigDecimal.sum(running, row.amount);
      expect(format(running)).toBe(format(row.balance));
    }
  });

  test("a tampered balance breaks the printed-amount reconciliation", () => {
    expect(block(markdown().replace("13,699.21 CR", "13,699.22 CR")).code).toBe("StatementGrammar");
  });

  test("a missing printed amount blocks the statement", () => {
    expect(block(markdown().replace("89.10\n", "\n")).code).toBe("StatementGrammar");
  });

  test("an extra stray amount blocks the statement", () => {
    expect(block(markdown().replace("ZZ001R1\n", "ZZ001R1\n\n77.77\n")).detail).toMatch(
      /printed amounts have no transaction/,
    );
  });

  test("tampered summary totals block as a reconciliation failure", () => {
    expect(block(markdown().replace("1,550.79", "1,550.80")).code).toBe("StatementReconciliation");
  });

  test("a row outside the statement period cannot reconstruct", () => {
    expect(block(markdown().replace("05 Jun FRESH MART", "05 Jul FRESH MART")).code).toBe(
      "StatementGrammar",
    );
  });
});
