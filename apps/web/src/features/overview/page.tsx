import type {
  AccountCoverage,
  CalendarDate,
  Money,
  PeriodChange,
  PeriodFlow,
  QuestionSummary,
  YearMonth,
} from "@repo/contracts/finance";
import { affectedMoney, formatCurrency, leftOver, periodLabel } from "@repo/finance";
import { Link } from "@tanstack/react-router";

import { Amount } from "@/components/amount";
import { ComparisonControl } from "@/components/comparison-control";
import { ComparisonCoverageNote, IncompleteRecordsNote } from "@/components/comparison-coverage";
import type { ComparisonKey, PeriodChoice } from "@/lib/period";
import { scopeSearch } from "@/lib/scope";

import { FlowDiagram } from "./flow-diagram";

const money = (currency: string, minor: bigint): Money => ({ currency, minor });
const days = (start: string, end: string) =>
  Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);

export function OverviewPage({
  flow,
  period,
  compare,
  onCompare,
  firstMonth,
  today,
  questions,
}: {
  flow: PeriodFlow;
  period: PeriodChoice;
  compare: ComparisonKey | undefined;
  onCompare: (compare: ComparisonKey | undefined) => void;
  firstMonth: YearMonth;
  today: CalendarDate;
  questions: typeof QuestionSummary.Type;
}) {
  // The dates compared, which for a period in progress are only the same days.
  const previousLabel = periodLabel(flow.comparison);
  const unrecorded = flow.comparisonCoverage.state === "missing";
  const surplus = leftOver(flow.totals);
  return (
    <div className="space-y-12">
      <header className="space-y-6">
        <div>
          <h1 className="type-title">{period.label}</h1>
          <div className="mt-1 space-y-1">
            <ComparisonControl
              period={period}
              current={flow.period}
              comparison={flow.comparison}
              value={compare}
              onChange={onCompare}
              firstMonth={firstMonth}
              today={today}
            />
            <ComparisonCoverageNote
              coverage={flow.comparisonCoverage}
              comparison={flow.comparison}
            />
            <IncompleteRecordsNote
              coverage={flow.coverage}
              period={flow.period}
              label={period.label}
            />
          </div>
        </div>
        <dl className="grid gap-x-12 gap-y-6 sm:grid-cols-[auto_auto_1fr]">
          <Figure
            label="Came in"
            swatch="bg-inflow"
            value={flow.totals.inflow}
            previous={unrecorded ? null : flow.previousTotals.inflow}
            previousLabel={previousLabel}
          />
          <Figure
            label="Went out"
            swatch="bg-outflow"
            value={flow.totals.outflow}
            previous={unrecorded ? null : flow.previousTotals.outflow}
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
            What changed compared with {previousLabel}
          </h2>
          {unrecorded ? (
            <p className="text-slate">There are no records to compare with.</p>
          ) : flow.changes.length === 0 ? (
            <p className="text-slate">Spending looks the same as in {previousLabel}.</p>
          ) : (
            <ul className="divide-y divide-rule">
              {flow.changes.map((change) => (
                <ChangeRow
                  key={"id" in change.category ? change.category.id : change.category.kind}
                  change={change}
                  previousLabel={previousLabel}
                />
              ))}
            </ul>
          )}
        </section>
        <div className="space-y-10">
          <NeedsYourEye questions={questions} label={period.label} />
          <Coverage coverage={flow.coverage} period={flow.period} />
        </div>
      </div>
    </div>
  );
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
  // Null when the comparison period has no records.
  previous: Money | null;
  previousLabel: string;
  note?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="flex items-center gap-2 type-small text-slate">
        <span aria-hidden className={`size-2 rounded-[2px] ${swatch}`} />
        {label}
      </dt>
      <dd className="mt-1 space-y-1">
        <span className="block type-figure">{formatCurrency(value, { cents: false })}</span>
        <span className="block type-small text-slate">
          <Change value={value} previous={previous} previousLabel={previousLabel} />
        </span>
        {note && <span className="block type-small text-slate">{note}</span>}
      </dd>
    </div>
  );
}

function Change({
  value,
  previous,
  previousLabel,
}: {
  value: Money;
  previous: Money | null;
  previousLabel: string;
}) {
  if (!previous) return "No records to compare with";
  const delta = value.minor - previous.minor;
  if (delta === 0n) return `The same as in ${previousLabel}`;
  return (
    <>
      <Amount value={money(value.currency, delta < 0n ? -delta : delta)} cents={false} />{" "}
      {delta > 0n ? "more" : "less"} than in {previousLabel}
    </>
  );
}

function ChangeRow({ change, previousLabel }: { change: PeriodChange; previousLabel: string }) {
  const delta = change.change.minor;
  const size = money(change.current.currency, delta < 0n ? -delta : delta);
  return (
    <li className="py-3">
      <Link
        to="/spending"
        search={scopeSearch({ category: change.category, counterparty: { kind: "all" } })}
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
        {change.previousAveragePurchase && change.averagePurchase && (
          <span className="col-span-2 type-small text-slate">
            {change.purchases} {change.purchases === 1 ? "purchase" : "purchases"} instead of{" "}
            {change.previousPurchases}, and the average went from{" "}
            <Amount value={change.previousAveragePurchase} cents={false} /> to{" "}
            <Amount value={change.averagePurchase} cents={false} />.
          </span>
        )}
      </Link>
    </li>
  );
}

// The questions whose transactions fall in the period, and the money those transactions
// move. The figure opens Questions narrowed to the period.
function NeedsYourEye({
  questions,
  label,
}: {
  questions: typeof QuestionSummary.Type;
  label: string;
}) {
  return (
    <section aria-labelledby="questions-heading" className="space-y-3">
      <h2 id="questions-heading" className="type-heading">
        Needs your eye
      </h2>
      {questions.count === 0 ? (
        <p className="text-slate">Nothing in {label} is waiting on you.</p>
      ) : (
        <Link
          to="/questions"
          search={{ scope: "period" }}
          className="group block space-y-1 rounded-sm"
        >
          <p>
            <span className="type-figure-s text-attention tabular">{questions.count}</span>{" "}
            {questions.count === 1 ? "question affects" : "questions affect"}{" "}
            <Amount value={affectedMoney(questions)} cents={false} className="font-[560]" /> in{" "}
            {label}.
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
