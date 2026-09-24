import type { LedgerRow } from "@repo/contracts/finance";
import { Link } from "@tanstack/react-router";

import { Amount } from "@/components/amount";
import { ProvenanceMark } from "@/components/provenance";
import { categoryColor } from "@/lib/category-colors";

const dayFormat = new Intl.DateTimeFormat("en-AU", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function LedgerList({ rows }: { rows: readonly LedgerRow[] }) {
  const days = [...new Set(rows.map((row) => row.postedOn))];
  return (
    <div className="space-y-6">
      {days.map((day) => (
        <section key={day} aria-label={dayFormat.format(new Date(`${day}T00:00:00`))}>
          <h2 className="sticky top-0 z-10 border-b border-rule bg-background py-1.5 type-small text-slate">
            {dayFormat.format(new Date(`${day}T00:00:00`))}
          </h2>
          <ul>
            {rows
              .filter((row) => row.postedOn === day)
              .map((row) => (
                <li key={row.id} className="border-b border-rule/70 last:border-0">
                  <LedgerLine row={row} />
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function LedgerLine({ row }: { row: LedgerRow }) {
  const inflow = row.amount.minor > 0n;
  return (
    <Link
      to="/ledger/$id"
      params={{ id: row.id }}
      className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5 rounded-sm px-1 py-2.5 hover:bg-sheet sm:grid-cols-[minmax(0,1fr)_14rem_9rem_auto]"
    >
      <span className="min-w-0">
        <span className="block truncate">{row.counterpartyName ?? row.description}</span>
        {row.counterpartyName && (
          <span className="block truncate type-small text-slate">{row.description}</span>
        )}
      </span>
      <span className="col-start-1 flex min-w-0 items-center gap-2 type-small text-slate sm:col-start-auto">
        {row.categoryName || row.split ? (
          <>
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-[2px]"
              style={{ background: categoryColor(row.categorySlug) }}
            />
            <span className="truncate text-intaglio">{row.split ? "Split" : row.categoryName}</span>
          </>
        ) : (
          <span className="truncate">{roleLabel(row)}</span>
        )}
        <ProvenanceMark assignedBy={row.assignedBy} question={row.question} />
      </span>
      <span className="hidden truncate type-small text-slate sm:block">{row.accountLabel}</span>
      <Amount
        value={row.amount}
        signed
        className={`row-span-2 row-start-1 self-center text-right sm:row-span-1 ${inflow ? "text-inflow" : ""}`}
      />
    </Link>
  );
}

function roleLabel(row: LedgerRow) {
  switch (row.role) {
    case "transfer":
      return "Between your accounts";
    case "cardSettlement":
      return "Card payment";
    case "loanPayment":
      return "Loan repayment";
    case "borrowing":
      return "Borrowed";
    case "income":
      return "Income";
    case "refund":
    case "reimbursement":
      return "Money back";
    case "unresolved":
    case null:
      return "Not yet understood";
    case "purchase":
    case "financingCost":
      return "Not yet categorised";
  }
}
