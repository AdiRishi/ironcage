import type {
  AccountCoverage,
  Money,
  PeriodChange,
  PeriodFlow,
  Question,
} from "@repo/contracts/finance";
import { formatCurrency } from "@repo/finance";
import { Link } from "@tanstack/react-router";

import { Amount } from "@/components/amount";
import type { ResolvedPeriod } from "@/lib/period";

import { FlowDiagram } from "./flow-diagram";

const money = (currency: string, minor: bigint): Money => ({ currency, minor });
const days = (start: string, end: string) =>
  Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);

export function OverviewPage({
  flow,
  period,
  questions,
}: {
  flow: PeriodFlow;
  period: ResolvedPeriod;
  questions: readonly Question[];
}) {
  const previousLabel = comparisonLabel(period);
  const recordsEnd = lastRecordedDay(flow);
  const surplus = money(flow.currency, flow.totals.inflow.minor - flow.totals.outflow.minor);
  return (
    <div className="space-y-12">
      <header className="space-y-6">
        <div>
          <h1 className="type-title">{period.label}</h1>
          {period.current && (
            <p className="mt-1 type-small text-slate">
              {days(flow.period.start, flow.period.endExclusive)} days so far, compared with the
              same days of {previousLabel}.
            </p>
          )}
          {recordsEnd && (
            <p className="mt-1 type-small text-intaglio">
              <span
                aria-hidden
                className="mr-1.5 inline-block size-2 rounded-full border-[1.5px] border-outflow"
              />
              Your records stop on {recordsEnd}, so this {period.unit} is incomplete. Upload later
              statements to finish it.
            </p>
          )}
        </div>
        <dl className="grid gap-x-12 gap-y-6 sm:grid-cols-[auto_auto_1fr]">
          <Figure
            label="Came in"
            swatch="bg-inflow"
            value={flow.totals.inflow}
            previous={flow.previousTotals.inflow}
            previousLabel={previousLabel}
          />
          <Figure
            label="Went out"
            swatch="bg-outflow"
            value={flow.totals.outflow}
            previous={flow.previousTotals.outflow}
            previousLabel={previousLabel}
            note={
              flow.modelShare.minor > 0n ? (
                <>
                  <span
                    aria-hidden
                    className="mr-1.5 inline-block size-2 rounded-full border border-slate"
                  />
                  <Amount value={flow.modelShare} cents={false} /> of spending rests on the model's
                  judgement.
                </>
              ) : null
            }
          />
          <div className="sm:self-end">
            <dt className="type-small text-slate">
              {surplus.minor >= 0n ? "Left over" : "Short by"}
            </dt>
            <dd className="mt-1 type-figure-s">
              {formatCurrency(surplus.minor < 0n ? money(flow.currency, -surplus.minor) : surplus, {
                cents: false,
              })}
            </dd>
          </div>
        </dl>
      </header>

      <section aria-labelledby="flow-heading" className="space-y-4">
        <h2 id="flow-heading" className="type-heading">
          Where it came from and where it went
        </h2>
        <FlowDiagram flow={flow} />
        {flow.totals.internal.minor > 0n && (
          <p className="type-small text-slate">
            <Amount value={flow.totals.internal} cents={false} /> moved between your own accounts
            and is left out of both sides.
          </p>
        )}
      </section>

      <div className="grid gap-12 border-t border-rule pt-10 lg:grid-cols-[7fr_5fr]">
        <section aria-labelledby="changes-heading" className="space-y-4">
          <h2 id="changes-heading" className="type-heading">
            What changed since {previousLabel}
          </h2>
          {flow.changes.length === 0 ? (
            <p className="text-slate">Spending looks the same as {previousLabel}.</p>
          ) : (
            <ul className="divide-y divide-rule">
              {flow.changes.map((change) => (
                <ChangeRow
                  key={change.categoryId ?? "none"}
                  change={change}
                  previousLabel={previousLabel}
                />
              ))}
            </ul>
          )}
        </section>
        <div className="space-y-10">
          <NeedsAnswers questions={questions} currency={flow.currency} />
          <Coverage coverage={flow.coverage} period={flow.period} />
        </div>
      </div>
    </div>
  );
}

// The last day any account has records for, when that is before the period ends.
function lastRecordedDay(flow: PeriodFlow) {
  const end = flow.coverage
    .flatMap((item) => item.observed.map((interval) => interval.endExclusive))
    .filter((date) => date > flow.period.start)
    .toSorted()
    .at(-1);
  if (!end || end >= flow.period.endExclusive) return null;
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(Date.parse(end) - 86_400_000);
}

function comparisonLabel(period: ResolvedPeriod) {
  if (period.unit === "year") return String(period.year - 1);
  const previous = new Date(period.year, (period.month ?? 1) - 2, 1);
  return new Intl.DateTimeFormat("en-AU", { month: "long" }).format(previous);
}

function Figure({
  label,
  swatch,
  value,
  previous,
  previousLabel,
  note,
}: {
  label: string;
  swatch: string;
  value: Money;
  previous: Money;
  previousLabel: string;
  note?: React.ReactNode;
}) {
  const delta = value.minor - previous.minor;
  return (
    <div>
      <dt className="flex items-center gap-2 type-small text-slate">
        <span aria-hidden className={`size-2 rounded-[2px] ${swatch}`} />
        {label}
      </dt>
      <dd className="mt-1 space-y-1">
        <span className="block type-figure">{formatCurrency(value, { cents: false })}</span>
        <span className="block type-small text-slate">
          {delta === 0n ? (
            `The same as ${previousLabel}`
          ) : (
            <>
              <Amount value={money(value.currency, delta < 0n ? -delta : delta)} cents={false} />{" "}
              {delta > 0n ? "more" : "less"} than {previousLabel}
            </>
          )}
        </span>
        {note && <span className="block type-small text-slate">{note}</span>}
      </dd>
    </div>
  );
}

function ChangeRow({ change, previousLabel }: { change: PeriodChange; previousLabel: string }) {
  const delta = change.current.minor - change.previous.minor;
  const size = money(change.current.currency, delta < 0n ? -delta : delta);
  const average = (total: Money, count: number) =>
    formatCurrency(money(total.currency, count === 0 ? 0n : total.minor / BigInt(count)), {
      cents: false,
    });
  return (
    <li className="py-3">
      <Link
        to="/spending"
        search={{ category: change.categoryId ?? undefined }}
        className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 rounded-sm"
      >
        <span>
          {change.previous.minor === 0n ? (
            <>
              <strong className="font-[600]">{change.label}</strong>:{" "}
              <Amount value={change.current} cents={false} />, none in {previousLabel}.
            </>
          ) : (
            <>
              <strong className="font-[600]">{change.label}</strong> {delta > 0n ? "rose" : "fell"}{" "}
              <Amount value={size} cents={false} /> to{" "}
              <Amount value={change.current} cents={false} />.
            </>
          )}
        </span>
        <span
          className={`self-center type-small tabular ${delta > 0n ? "text-intaglio" : "text-slate"}`}
        >
          {delta > 0n ? "+" : "−"}
          {formatCurrency(size, { cents: false })}
        </span>
        {change.previousPurchases > 0 && change.purchases > 0 && change.purchasesPart && (
          <span className="col-span-2 type-small text-slate">
            {change.purchases} {change.purchases === 1 ? "purchase" : "purchases"} instead of{" "}
            {change.previousPurchases}, and the average went from{" "}
            {average(change.previous, change.previousPurchases)} to{" "}
            {average(change.current, change.purchases)}.
          </span>
        )}
      </Link>
    </li>
  );
}

function NeedsAnswers({
  questions,
  currency,
}: {
  questions: readonly Question[];
  currency: string;
}) {
  const amount = questions.reduce(
    (sum, question) => sum + question.outflow.minor + question.inflow.minor,
    0n,
  );
  return (
    <section aria-labelledby="questions-heading" className="space-y-3">
      <h2 id="questions-heading" className="type-heading">
        Needs your answer
      </h2>
      {questions.length === 0 ? (
        <p className="text-slate">Nothing is waiting on you.</p>
      ) : (
        <Link to="/questions" className="group block space-y-1 rounded-sm">
          <p>
            <span className="type-figure-s text-attention tabular">{questions.length}</span>{" "}
            {questions.length === 1 ? "question affects" : "questions affect"}{" "}
            <Amount value={money(currency, amount)} cents={false} className="font-[560]" /> across
            your history.
          </p>
          <p className="type-small text-slate group-hover:text-intaglio">
            Answer them to make every total more certain.
          </p>
        </Link>
      )}
    </section>
  );
}

function Coverage({
  coverage,
  period,
}: {
  coverage: readonly AccountCoverage[];
  period: PeriodFlow["period"];
}) {
  const total = days(period.start, period.endExclusive);
  const segments = (intervals: AccountCoverage["observed"]) =>
    intervals.flatMap((interval) => {
      const start = interval.start > period.start ? interval.start : period.start;
      const end =
        interval.endExclusive < period.endExclusive ? interval.endExclusive : period.endExclusive;
      return start < end
        ? [{ left: days(period.start, start) / total, width: days(start, end) / total }]
        : [];
    });
  return (
    <section aria-labelledby="coverage-heading" className="space-y-3">
      <h2 id="coverage-heading" className="type-heading">
        Records behind these numbers
      </h2>
      <ul className="space-y-3">
        {coverage.map((item) => (
          <li key={item.account.id} className="space-y-1">
            <div className="flex justify-between gap-3">
              <span>{item.account.label}</span>
              <span className="type-small text-slate">
                {item.missing.length === 0
                  ? "Complete and reconciled"
                  : segments(item.observed).length === 0
                    ? "No records"
                    : "Some dates missing"}
              </span>
            </div>
            <div className="relative h-1.5 rounded-full bg-rule/60" aria-hidden>
              {segments(item.observed).map((segment, index) => (
                <span
                  key={`o${index}`}
                  className="absolute inset-y-0 rounded-full bg-intaglio/30"
                  style={{ left: `${segment.left * 100}%`, width: `${segment.width * 100}%` }}
                />
              ))}
              {segments(item.reconciled).map((segment, index) => (
                <span
                  key={`r${index}`}
                  className="absolute inset-y-0 rounded-full bg-intaglio"
                  style={{ left: `${segment.left * 100}%`, width: `${segment.width * 100}%` }}
                />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
