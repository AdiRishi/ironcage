import type { BankAccount } from "@repo/contracts/finance";

import { lines, text, type PdfPage, type PdfText } from "./text.ts";

export type StatementKind = (typeof BankAccount.Type)["kind"];
export type PdfRow = {
  page: number;
  row: number;
  date: string;
  items: PdfText[];
  description: string;
  debit: string;
  credit: string;
  balance: string;
};
const columns = {
  deposit: { amount: 300, credit: 400, balance: 460 },
  loan: { amount: 300, credit: 380, balance: 450 },
  card: { amount: 500, credit: 600, balance: 600 },
};
export function tableRows(page: PdfPage, pageNumber: number, kind: StatementKind): PdfRow[] {
  const header = page.find((item) => item.str === "Date" && item.x < 80);
  if (
    !header ||
    !page.some(
      (item) =>
        Math.abs(item.y - header.y) < 2 &&
        (kind === "card" ? item.str.startsWith("Amount") : /^Debits?$/.test(item.str)),
    )
  )
    return [];
  const layout = columns[kind];
  const rows: PdfRow[] = [];
  let current: PdfRow | undefined;
  for (const line of lines(
    page.filter((item) => item.y < header.y - 3 && item.x >= 50 && item.y > 45),
  )) {
    const left = line.find((item) => item.x < 80);
    if (
      left &&
      /^Please check|^Opening balance|^Important|^Transaction Summary|^Total/.test(left.str)
    )
      break;
    const date = left
      ? (/BALANCE/i.test(left.str)
          ? /^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\b/
          : /^\d{1,2}\s+[A-Za-z]{3,9}\b/
        ).exec(left.str)
      : null;
    if (left) {
      current = {
        page: pageNumber,
        row: rows.length + 1,
        date: date?.[0] ?? left.str,
        items: [],
        description: "",
        debit: "",
        credit: "",
        balance: "",
      };
      rows.push(current);
    }
    if (!current) continue;
    current.items.push(...line);
    if (
      kind === "card" &&
      !left &&
      line.some((item) => item.x >= layout.amount && /^0[ .]00$/.test(item.str.trim()))
    )
      continue;
    for (const item of line) {
      const str = item === left && date ? item.str.slice(date[0].length).trim() : item.str;
      if (!str || (item.x >= layout.amount && /^[($]$/.test(str))) continue;
      const key =
        item.x < layout.amount
          ? "description"
          : item.x + item.width > layout.balance
            ? "balance"
            : item.x + item.width > layout.credit
              ? "credit"
              : "debit";
      // Card amount cells share the dated baseline; later cells are fee notices.
      if (kind === "card" && key === "debit" && !date) continue;
      current[key] = `${current[key]} ${str}`.trim();
    }
    if (/CLOSING BALANCE/i.test(current.description)) break;
  }
  return rows;
}
export const rawRow = (row: PdfRow) => ({
  date: row.date,
  description: row.description,
  debit: row.debit,
  credit: row.credit,
  balance: row.balance,
  text: text(row.items),
  positions: JSON.stringify(row.items),
});
