import { BigDecimal, Effect } from "effect";
import { describe, expect, test } from "vitest";

import type { BankImportBlocked } from "../../src/money/import/block";
import { parseOffsetStatement } from "../../src/money/import/commbank-offset-statement";
import statementBytes from "../fixtures/money/commbank/statement/offset-statement-a.md?bytes";

const markdown = () => new TextDecoder().decode(statementBytes);
const parse = (text: string) => Effect.runSync(parseOffsetStatement(text));
const block = (text: string): BankImportBlocked =>
  Effect.runSync(Effect.flip(parseOffsetStatement(text)));
const format = (value: BigDecimal.BigDecimal) => BigDecimal.format(BigDecimal.normalize(value));

describe("the CommBank offset statement profile", () => {
  test("reconstructs extracted page shapes and proves the balance chain", () => {
    const statement = parse(markdown());

    expect(statement.accountNumber).toBe("99 9999 10000001");
    expect(statement.period).toEqual({ start: "2032-03-25", end: "2032-06-24" });
    expect(statement.rows).toHaveLength(11);
    expect(format(statement.opening)).toBe("10000");
    expect(format(statement.closing)).toBe("13469.21");
    expect(format(statement.totalDebits)).toBe("1550.79");
    expect(format(statement.totalCredits)).toBe("5020");
    expect(statement.rows[3]).toMatchObject({
      postedDate: "2032-04-02",
      narrative: expect.stringContaining("Salary EMPLOYER PTY LT"),
    });
    expect(format(statement.rows[3]!.amount)).toBe("5000");
    expect(format(statement.rows[6]!.amount)).toBe("20");
    expect(statement.rows[9]).toMatchObject({
      postedDate: "2032-05-20",
      narrative: expect.stringContaining("Wdl ATM"),
    });

    let running = statement.opening;
    for (const row of statement.rows) {
      running = BigDecimal.sum(running, row.amount);
      expect(format(running)).toBe(format(row.balance));
    }
  });

  test("blocks extracted content that cannot prove every transaction amount", () => {
    expect(block(markdown().replace("89.10\n", "\n")).code).toBe("StatementGrammar");
    expect(block(markdown().replace("ZZ001R1\n", "ZZ001R1\n\n77.77\n")).detail).toMatch(
      /printed amounts have no transaction/,
    );
  });

  test("blocks a statement whose summary disagrees with its reconstructed rows", () => {
    expect(block(markdown().replace("1,550.79", "1,550.80")).code).toBe("StatementReconciliation");
  });

  test("blocks transaction dates outside the statement period", () => {
    expect(block(markdown().replace("05 Jun FRESH MART", "05 Jul FRESH MART")).code).toBe(
      "StatementGrammar",
    );
  });
});
