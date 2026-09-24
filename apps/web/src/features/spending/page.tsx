import type { Money, SpendingBreakdown, SpendingRow } from "@repo/contracts/finance";
import { formatCurrency } from "@repo/finance";
import { Link } from "@tanstack/react-router";

import { Amount } from "@/components/amount";
import { categoryColor } from "@/lib/category-colors";
import { monthLabel, type ResolvedPeriod } from "@/lib/period";

const money = (currency: string, minor: bigint): Money => ({ currency, minor });

export function SpendingPage({
  breakdown,
  period,
  parents,
}: {
  breakdown: SpendingBreakdown;
  period: ResolvedPeriod;
  // Categories that have subcategories, so a row can open further.
  parents: ReadonlySet<string>;
}) {
  const scope = breakdown.path.at(-1);
  const delta = breakdown.total.minor - breakdown.previousTotal.minor;
  const largest = breakdown.rows.reduce(
    (max, row) => (row.current.minor > max ? row.current.minor : max),
    1n,
  );
  return (
    <div className="space-y-10">
      <header className="space-y-5">
        <nav aria-label="Category path" className="type-small text-slate">
          <ol className="flex flex-wrap items-center gap-x-2">
            <li>
              <Link to="/spending" search={{ category: undefined }} className="hover:text-intaglio">
                All spending
              </Link>
            </li>
            {breakdown.path.map((item) => (
              <li key={item.id} className="flex items-center gap-x-2">
                <span aria-hidden>/</span>
                <Link
                  to="/spending"
                  search={{ category: item.id }}
                  className="hover:text-intaglio"
                  aria-current={item.id === scope?.id ? "page" : undefined}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ol>
        </nav>
        <div>
          <h1 className="type-title">
            {scope ? scope.label : "Spending"} in {period.label}
          </h1>
          <p className="mt-2 type-figure">{formatCurrency(breakdown.total, { cents: false })}</p>
          <p className="mt-1 type-small text-slate">
            {delta === 0n ? (
              "The same as the period before."
            ) : (
              <>
                <Amount
                  value={money(breakdown.currency, delta < 0n ? -delta : delta)}
                  cents={false}
                />{" "}
                {delta > 0n ? "more" : "less"} than the period before, which was{" "}
                <Amount value={breakdown.previousTotal} cents={false} />.
              </>
            )}{" "}
            {breakdown.modelAmount.minor > 0n && (
              <>
                <Amount value={breakdown.modelAmount} cents={false} /> of it rests on the model's
                judgement.
              </>
            )}
          </p>
        </div>
      </header>

      <section aria-labelledby="rows-heading" className="space-y-3">
        <h2 id="rows-heading" className="sr-only">
          {scope ? `Within ${scope.label}` : "By category"}
        </h2>
        {breakdown.rows.length === 0 ? (
          <p className="text-slate">No spending here in {period.label}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-rule text-left type-small text-slate">
                  <th scope="col" className="py-2 font-normal">
                    Category
                  </th>
                  <th scope="col" className="py-2 text-right font-normal">
                    {period.label}
                  </th>
                  <th scope="col" className="py-2 text-right font-normal">
                    Change
                  </th>
                  <th scope="col" className="py-2 text-right font-normal">
                    Purchases
                  </th>
                  <th scope="col" className="py-2 pl-6 font-normal">
                    Last twelve months
                  </th>
                </tr>
              </thead>
              <tbody>
                {breakdown.rows.map((row) => (
                  <Row
                    key={row.categoryId ?? "none"}
                    row={row}
                    months={breakdown.months}
                    largest={largest}
                    opens={
                      row.categoryId !== null &&
                      parents.has(row.categoryId) &&
                      row.categoryId !== scope?.id
                    }
                    topSlug={scope?.slug ?? row.slug}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {breakdown.counterparties.length > 0 && (
        <section
          aria-labelledby="counterparties-heading"
          className="space-y-3 border-t border-rule pt-8"
        >
          <h2 id="counterparties-heading" className="type-heading">
            Who it went to
          </h2>
          <ul className="grid gap-x-10 sm:grid-cols-2">
            {breakdown.counterparties.map((row) => (
              <li
                key={row.counterpartyId ?? "none"}
                className="flex items-baseline justify-between gap-4 border-b border-rule py-2"
              >
                {row.counterpartyId ? (
                  <Link
                    to="/counterparties/$counterpartyId"
                    params={{ counterpartyId: row.counterpartyId }}
                    className="truncate hover:underline"
                  >
                    {row.label}
                  </Link>
                ) : (
                  <span className="truncate text-slate">{row.label}</span>
                )}
                <span className="flex shrink-0 items-baseline gap-3">
                  <span className="type-small text-slate">
                    {row.purchases} {row.purchases === 1 ? "purchase" : "purchases"}
                  </span>
                  <Amount value={row.current} cents={false} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Row({
  row,
  months,
  largest,
  opens,
  topSlug,
}: {
  row: SpendingRow;
  months: readonly string[];
  largest: bigint;
  opens: boolean;
  topSlug: string | null;
}) {
  const delta = row.current.minor - row.previous.minor;
  const color = categoryColor(topSlug);
  const share = Number((row.current.minor * 1000n) / largest) / 10;
  const label = (
    <span className="flex items-center gap-3">
      <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />
      <span className="min-w-0">
        <span className="block truncate">{row.label}</span>
        <span aria-hidden className="mt-1 block h-1 rounded-full bg-rule/60">
          <span
            className="block h-full rounded-full"
            style={{ width: `${Math.max(share, 0)}%`, background: color }}
          />
        </span>
      </span>
    </span>
  );
  return (
    <tr className="border-b border-rule">
      <th scope="row" className="py-3 pr-4 text-left font-normal">
        {opens && row.categoryId ? (
          <Link
            to="/spending"
            search={{ category: row.categoryId }}
            className="block rounded-sm hover:text-intaglio"
          >
            {label}
          </Link>
        ) : row.categoryId ? (
          <Link
            to="/ledger"
            search={{ categoryId: row.categoryId }}
            className="block rounded-sm hover:text-intaglio"
          >
            {label}
          </Link>
        ) : (
          <Link to="/questions" className="block rounded-sm hover:text-intaglio">
            {label}
          </Link>
        )}
      </th>
      <td className="py-3 text-right">
        <Amount value={row.current} cents={false} />
      </td>
      <td className="py-3 text-right type-small text-slate tabular">
        {row.previous.minor === 0n
          ? "New"
          : `${delta >= 0n ? "+" : "−"}${formatCurrency({ ...row.current, minor: delta < 0n ? -delta : delta }, { cents: false })}`}
      </td>
      <td className="py-3 text-right type-small text-slate tabular">
        {row.purchases > 0 ? row.purchases : ""}
      </td>
      <td className="py-3 pl-6">
        <Sparkline values={row.months} months={months} color={color} label={row.label} />
      </td>
    </tr>
  );
}

function Sparkline({
  values,
  months,
  color,
  label,
}: {
  values: readonly Money[];
  months: readonly string[];
  color: string;
  label: string;
}) {
  const largest = values.reduce((max, value) => (value.minor > max ? value.minor : max), 1n);
  const description = values
    .map(
      (value, index) =>
        `${monthLabel(months[index]?.slice(0, 7) ?? "")}: ${formatCurrency(value, { cents: false })}`,
    )
    .join(", ");
  return (
    <>
      <span className="sr-only">{`${label} by month. ${description}`}</span>
      <svg viewBox="0 0 120 24" className="h-6 w-[120px]" aria-hidden>
        {values.map((value, index) => {
          const height =
            value.minor <= 0n ? 0 : Math.max(1.5, Number((value.minor * 24n) / largest));
          return (
            <rect
              key={months[index] ?? index}
              x={index * 10 + 1}
              y={24 - height}
              width={8}
              height={height}
              rx={1.5}
              fill={color}
              opacity={index === values.length - 1 ? 1 : 0.45}
            >
              <title>
                {monthLabel(months[index]?.slice(0, 7) ?? "")}:{" "}
                {formatCurrency(value, { cents: false })}
              </title>
            </rect>
          );
        })}
      </svg>
    </>
  );
}
