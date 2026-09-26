import type {
  Account,
  CountedLedgerPage as CountedResult,
  LedgerPage as LedgerResult,
  Money,
} from "@repo/contracts/finance";
import { measures } from "@repo/finance";
import { Link } from "@tanstack/react-router";
import { Struct } from "effect";
import { useState } from "react";

import { Amount } from "@/components/amount";
import { NoRecords } from "@/components/no-records";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SpendingPath } from "@/features/spending/path";
import type { PeriodChoice, PeriodRecords } from "@/lib/period";

import { TransactionFilters } from "./filters";
import { CountedList, LedgerList } from "./list";
import {
  type CountedSearch,
  countedFilter,
  countedSearch,
  type LedgerSearch,
  type PostingSearch,
  postingFilter,
} from "./search";

export function LedgerPage({
  search,
  period,
  records,
  timezone,
  page,
  accounts,
  navigate,
}: {
  search: PostingSearch;
  period: PeriodChoice;
  records: PeriodRecords;
  timezone: string;
  page: typeof LedgerResult.Type;
  accounts: readonly Account[];
  navigate: (search: PostingSearch) => void;
}) {
  const filter = postingFilter(search);
  const filtered = Object.keys(filter).length > 0;
  const scope = filter.importId
    ? "One file"
    : filter.questionId
      ? "One question"
      : filter.from || filter.to
        ? "Chosen dates"
        : period.label;
  const { nextCursor } = page;
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="type-title">Ledger</h1>
          <p className="mt-1 type-small text-slate">
            {scope}. Every transaction, what it means, and its evidence.
          </p>
        </div>
        <DescriptionSearch
          value={filter.description}
          onSearch={(description) =>
            navigate(
              description ? { ...filter, description } : Struct.omit(filter, ["description"]),
            )
          }
        />
      </header>
      <MoreFilters>
        <TransactionFilters
          key={JSON.stringify(filter)}
          filter={filter}
          accounts={accounts}
          onApply={async (next) => navigate(next)}
        />
      </MoreFilters>
      {page.rows.length === 0 && !filtered && records !== "recorded" ? (
        <NoRecords records={records} period={period} timezone={timezone} />
      ) : (
        <>
          {page.rows.length === 0 ? (
            <p className="text-slate">
              {filtered
                ? "No transactions match. Try another period or fewer filters."
                : `No transactions in ${period.label}.`}
            </p>
          ) : (
            <LedgerList rows={page.rows} />
          )}
          <Pager
            onNewest={search.cursor ? () => navigate(filter) : null}
            onOlder={nextCursor ? () => navigate({ ...filter, cursor: nextCursor }) : null}
          />
        </>
      )}
    </div>
  );
}

// The records behind a number, each with what it counts toward it. The scope owns the
// category, counterparty, currency, and dates, so those filters are not offered.
export function CountedLedgerPage({
  search,
  period,
  page,
  accounts,
  navigate,
}: {
  search: CountedSearch;
  period: PeriodChoice;
  page: typeof CountedResult.Type;
  accounts: readonly Account[];
  navigate: (search: LedgerSearch) => void;
}) {
  const scope = countedSearch(page.scope);
  const filter = countedFilter(search);
  const { nextCursor } = page;
  const filtered = Object.keys(filter).length > 0;
  const measure = measures[page.scope.measure].label;
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-4">
          <div>
            {page.path.length > 0 &&
              (page.scope.measure === "spending" ? (
                <SpendingPath
                  label="Counted in"
                  first={measure}
                  path={page.path}
                  narrowing={{ tag: filter.tagId, personalEvent: filter.personalEventId }}
                />
              ) : (
                <p className="type-small text-slate">{measure}</p>
              ))}
            <h1 className="type-title">
              {page.label} in {period.label}
            </h1>
            <p className="mt-1 type-small text-slate">
              The transactions behind this number, on the day each one counts.
              {filtered && " Only those that match your filters are counted."}{" "}
              <Link to="/ledger" search={{}} className="text-intaglio underline underline-offset-4">
                Show every transaction in {period.label}
              </Link>
            </p>
          </div>
          <p className="type-figure-s">
            <Amount value={page.total} />
          </p>
          {page.parts.length > 1 && (
            <dl className="grid w-fit grid-cols-[auto_auto] gap-x-8 gap-y-1 type-small">
              {page.parts.map((part) => (
                <div key={part.label} className="contents">
                  <dt className="text-slate">{part.label}</dt>
                  <dd className="text-right">
                    <Amount value={part.sign === "less" ? negated(part.amount) : part.amount} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {page.scope.measure === "loanPrincipal" && (
            <p className="max-w-prose type-small text-slate">
              Interest and fees on your loans already count as spending, so they are taken off the
              repayments. Principal is never below zero.
            </p>
          )}
        </div>
        <DescriptionSearch
          value={filter.description}
          onSearch={(description) => {
            const next = description
              ? { ...filter, description }
              : Struct.omit(filter, ["description"]);
            navigate({ ...scope, ...next });
          }}
        />
      </header>
      <MoreFilters>
        <TransactionFilters
          key={JSON.stringify(filter)}
          filter={filter}
          accounts={accounts}
          counted={{ currency: page.currency }}
          onApply={async (next) => navigate({ ...scope, ...countedFilter(next) })}
        />
      </MoreFilters>
      {page.rows.length === 0 ? (
        <p className="text-slate">
          {filtered
            ? "No transactions match. Try fewer filters."
            : `No transactions count toward this in ${period.label}. Choose another period above.`}
        </p>
      ) : (
        <CountedList rows={page.rows} parts={page.parts} />
      )}
      <Pager
        onNewest={search.cursor ? () => navigate({ ...scope, ...filter }) : null}
        onOlder={nextCursor ? () => navigate({ ...scope, ...filter, cursor: nextCursor }) : null}
      />
    </div>
  );
}

const negated = (money: Money): Money => ({ ...money, minor: -money.minor });

function DescriptionSearch({
  value,
  onSearch,
}: {
  value: string | undefined;
  onSearch: (description: string) => void;
}) {
  const [text, setText] = useState(value ?? "");
  return (
    <search className="w-full sm:w-auto">
      <form
        className="flex w-full gap-2 sm:w-auto"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(text.trim());
        }}
      >
        <Input
          aria-label="Search descriptions and counterparties"
          placeholder="Search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="sm:w-64"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
    </search>
  );
}

function MoreFilters({ children }: { children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border border-rule bg-sheet">
      <summary className="cursor-pointer list-none px-4 py-3 text-slate hover:text-intaglio">
        More filters
      </summary>
      <div className="border-t border-rule p-4">{children}</div>
    </details>
  );
}

function Pager({
  onNewest,
  onOlder,
}: {
  onNewest: (() => void) | null;
  onOlder: (() => void) | null;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      {onNewest && (
        <Button variant="outline" onClick={onNewest}>
          Back to the newest
        </Button>
      )}
      <Button variant="outline" disabled={!onOlder} onClick={() => onOlder?.()}>
        Older transactions
      </Button>
    </div>
  );
}
