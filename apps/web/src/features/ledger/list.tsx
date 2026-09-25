import type {
  CalendarDate,
  CountedLedgerRow,
  CountedPart,
  LedgerRow,
  Money,
} from "@repo/contracts/finance";
import { uncategorisedLabel } from "@repo/finance";
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
const dateFormat = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const localDate = (day: CalendarDate) => new Date(`${day}T00:00:00`);

export function LedgerList({ rows }: { rows: readonly LedgerRow[] }) {
  return (
    <Days rows={rows} dayOf={(row) => row.postedOn} heading="h2">
      {(row) => <LedgerLine row={row} />}
    </Days>
  );
}

// Rows under the day that counts them. A number made of several parts lists each part
// under its own heading, in the order the total adds them.
export function CountedList({
  rows,
  parts,
}: {
  rows: readonly (typeof CountedLedgerRow.Type)[];
  parts: readonly (typeof CountedPart.Type)[];
}) {
  const line = (row: typeof CountedLedgerRow.Type) => <LedgerLine row={row} counted={row} />;
  if (parts.length === 1)
    return (
      <Days rows={rows} dayOf={(row) => row.on} heading="h2">
        {line}
      </Days>
    );
  return (
    <div className="space-y-10">
      {parts.map((part, index) => {
        const listed = rows.filter((row) => row.part === index);
        return (
          listed.length > 0 && (
            <section key={part.label} aria-label={part.label} className="space-y-3">
              <h2 className="type-heading">{part.label}</h2>
              <Days rows={listed} dayOf={(row) => row.on} heading="h3">
                {line}
              </Days>
            </section>
          )
        );
      })}
    </div>
  );
}

function Days<Row extends LedgerRow>({
  rows,
  dayOf,
  heading: Heading,
  children,
}: {
  rows: readonly Row[];
  dayOf: (row: Row) => CalendarDate;
  heading: "h2" | "h3";
  children: (row: Row) => React.ReactNode;
}) {
  const days = [...new Set(rows.map(dayOf))];
  return (
    <div className="space-y-6">
      {days.map((day) => (
        <section key={day} aria-label={dayFormat.format(localDate(day))}>
          <Heading className="sticky top-0 z-10 border-b border-rule bg-background py-1.5 type-small text-slate">
            {dayFormat.format(localDate(day))}
          </Heading>
          <ul>
            {rows
              .filter((row) => dayOf(row) === day)
              .map((row) => (
                <li key={row.id} className="border-b border-rule/70 last:border-0">
                  {children(row)}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function LedgerLine({
  row,
  counted,
}: {
  row: LedgerRow;
  // On a counted ledger, what the posting adds to the number and the day it counts on.
  counted?: { counted: Money; on: CalendarDate };
}) {
  const amount = counted?.counted ?? row.amount;
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
        {counted && counted.on !== row.postedOn && (
          <span className="block type-small text-slate">
            Posted {dateFormat.format(localDate(row.postedOn))}
          </span>
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
      <span className="col-start-2 row-span-2 row-start-1 self-center text-right whitespace-nowrap sm:col-start-4 sm:row-span-1">
        <Amount value={amount} signed className={amount.minor > 0n ? "text-inflow" : ""} />
        {counted && counted.counted.minor !== row.amount.minor && (
          <span className="block type-small text-slate">
            of <Amount value={row.amount} signed />
          </span>
        )}
      </span>
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
      return uncategorisedLabel;
  }
}
