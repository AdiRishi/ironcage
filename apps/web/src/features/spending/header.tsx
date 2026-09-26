import type {
  CalendarDate,
  ChangeFigures,
  Money,
  SpendingBreakdown,
  YearMonth,
} from "@repo/contracts/finance";
import { formatCurrency, periodLabel } from "@repo/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Amount } from "@/components/amount";
import { ComparisonControl } from "@/components/comparison-control";
import { ComparisonCoverageNote, IncompleteRecordsNote } from "@/components/comparison-coverage";
import { AskAbout } from "@/features/analyst/ask-about";
import { referenceDataQuery } from "@/features/events/queries";
import type { ComparisonKey, PeriodChoice } from "@/lib/period";
import { scopeSearch } from "@/lib/scope";

import { SpendingPath } from "./path";
import { ledgerSearch, type Narrowing, spendingContext } from "./search";

const list = new Intl.ListFormat("en-AU", { type: "conjunction" });
const whole = (amount: Money) => formatCurrency(amount, { cents: false });
const signed = (amount: Money) => `${amount.minor > 0n ? "+" : ""}${whole(amount)}`;
const size = (amount: Money): Money => ({
  ...amount,
  minor: amount.minor < 0n ? -amount.minor : amount.minor,
});
const purchaseCount = (count: number) => `${count} ${count === 1 ? "purchase" : "purchases"}`;

// What the open scope covers, named by its narrowest crumbs.
export function scopeName({ scope, path }: Pick<SpendingBreakdown, "scope" | "path">) {
  const category =
    path.findLast((crumb) => crumb.opens.counterparty.kind === "all")?.label ?? "Spending";
  switch (scope.counterparty.kind) {
    case "all":
      return category;
    case "unidentified":
      return `${category} at unidentified counterparties`;
    case "counterparty":
      return `${category} at ${path.at(-1)?.label}`;
  }
}

// The path down to the open scope, its four facts against the comparison, the way to its
// records and to its counterparty's page, and a question about it for the analyst.
export function SpendingHeader({
  breakdown,
  period,
  compare,
  onCompare,
  firstMonth,
  today,
  narrowing,
}: {
  breakdown: SpendingBreakdown;
  period: PeriodChoice;
  compare: ComparisonKey | undefined;
  onCompare: (compare: ComparisonKey | undefined) => void;
  firstMonth: YearMonth;
  today: CalendarDate;
  narrowing: Narrowing;
}) {
  const { figures, scope } = breakdown;
  // The dates compared, which for a period in progress are only the same days.
  const previousLabel = periodLabel(breakdown.comparison);
  const unrecorded = breakdown.comparisonCoverage.state === "missing";
  return (
    <div className="space-y-5">
      <SpendingPath
        label="Spending path"
        first="All spending"
        path={breakdown.path}
        narrowing={narrowing}
      />
      <div>
        <h1 className="type-title">
          {scopeName(breakdown)} in {period.label}
        </h1>
        <div className="mt-1 space-y-1">
          <ComparisonControl
            period={period}
            current={breakdown.period}
            comparison={breakdown.comparison}
            value={compare}
            onChange={onCompare}
            firstMonth={firstMonth}
            today={today}
          />
          <ComparisonCoverageNote
            coverage={breakdown.comparisonCoverage}
            comparison={breakdown.comparison}
          />
          <IncompleteRecordsNote
            coverage={breakdown.coverage}
            period={breakdown.period}
            label={period.label}
          />
          {(narrowing.tag || narrowing.personalEvent) && (
            <NarrowingNote breakdown={breakdown} narrowing={narrowing} />
          )}
        </div>
        <p className="mt-4 type-figure">{whole(figures.current)}</p>
        <div className="mt-1 max-w-prose space-y-1 type-small text-slate">
          <p>
            <Change figures={figures} previousLabel={previousLabel} unrecorded={unrecorded} />
          </p>
          <Purchases figures={figures} previousLabel={previousLabel} unrecorded={unrecorded} />
          {!unrecorded && <ChangeParts figures={figures} />}
          {figures.modelAmount.minor > 0n && (
            <p>
              <span
                aria-hidden
                className="mr-1.5 inline-block size-2 rounded-full border-[1.5px] border-slate"
              />
              <Amount value={figures.modelAmount} cents={false} /> of this is model-assigned.
            </p>
          )}
          <p className="flex flex-wrap gap-x-6 gap-y-1">
            <Link
              to="/ledger"
              search={ledgerSearch(scope, narrowing)}
              className="text-intaglio underline underline-offset-4"
            >
              See these transactions in the ledger
            </Link>
            {scope.counterparty.kind === "counterparty" && (
              <Link
                to="/counterparties/$counterpartyId"
                params={{ counterpartyId: scope.counterparty.id }}
                className="text-intaglio underline underline-offset-4"
              >
                Open the page for {breakdown.path.at(-1)?.label}
              </Link>
            )}
          </p>
        </div>
        <div className="mt-4">
          <AskAbout about={spendingContext(scope, period, compare, narrowing)} />
        </div>
      </div>
    </div>
  );
}

function Change({
  figures,
  previousLabel,
  unrecorded,
}: {
  figures: ChangeFigures;
  previousLabel: string;
  unrecorded: boolean;
}) {
  const { change, previous, percentChange } = figures;
  if (unrecorded) return "No records to compare with.";
  if (change.minor === 0n) return `The same as in ${previousLabel}.`;
  if (previous.minor === 0n) return `New: none in ${previousLabel}.`;
  return (
    <>
      <Amount value={size(change)} cents={false} />
      {percentChange !== null && ` (${Math.abs(percentChange)}%)`}{" "}
      {change.minor > 0n ? "more" : "less"} than in {previousLabel}, which was{" "}
      <Amount value={previous} cents={false} />.
    </>
  );
}

function Purchases({
  figures,
  previousLabel,
  unrecorded,
}: {
  figures: ChangeFigures;
  previousLabel: string;
  unrecorded: boolean;
}) {
  const { purchases, previousPurchases, averagePurchase, previousAveragePurchase } = figures;
  if (purchases === 0 && (unrecorded || previousPurchases === 0)) return null;
  const before = previousAveragePurchase
    ? `${previousPurchases} averaging ${whole(previousAveragePurchase)}`
    : "none";
  return (
    <p className="tabular">
      {averagePurchase
        ? `${purchaseCount(purchases)} averaging ${whole(averagePurchase)}`
        : "No purchases"}
      {!unrecorded && `, against ${before} in ${previousLabel}`}.
    </p>
  );
}

// Where the change came from. With purchases in both periods the parts add up to it.
// With purchases in only one, the change in purchases stays whole and only the rest is
// told apart. With purchases in neither, the whole change is spending that is not a
// purchase, which the change itself already says.
function ChangeParts({ figures }: { figures: ChangeFigures }) {
  const { change, purchasesPart, averagePart, otherPart, purchases, previousPurchases } = figures;
  if (change.minor === 0n || (purchases === 0 && previousPurchases === 0)) return null;
  const parts = [
    purchasesPart && purchasesPart.minor !== 0n
      ? `${signed(purchasesPart)} from ${purchases > previousPurchases ? "more" : "fewer"} purchases`
      : null,
    averagePart && averagePart.minor !== 0n
      ? `${signed(averagePart)} from a ${averagePart.minor > 0n ? "higher" : "lower"} average purchase`
      : null,
    otherPart.minor !== 0n ? `${signed(otherPart)} from spending that is not a purchase` : null,
  ].filter((part) => part !== null);
  if (parts.length === 0) return null;
  return (
    <p className="tabular">
      The change {purchasesPart ? "is" : "includes"} {list.format(parts)}.
    </p>
  );
}

// Names the tag or personal event the scope is narrowed to, and offers the whole scope.
function NarrowingNote({
  breakdown,
  narrowing,
}: {
  breakdown: SpendingBreakdown;
  narrowing: Narrowing;
}) {
  const { data: references } = useSuspenseQuery(referenceDataQuery());
  const tag = references.tags.find((item) => item.id === narrowing.tag);
  const event = references.personalEvents.find((item) => item.id === narrowing.personalEvent);
  const names = [
    narrowing.tag ? `tagged ${tag?.name ?? "with a removed tag"}` : null,
    narrowing.personalEvent ? `for ${event?.name ?? "a removed personal event"}` : null,
  ].filter((name) => name !== null);
  return (
    <p className="type-small text-intaglio">
      Only spending {list.format(names)}.{" "}
      <Link
        to="/spending"
        search={scopeSearch(breakdown.scope)}
        className="underline underline-offset-4"
      >
        Show all of it
      </Link>
    </p>
  );
}
