import type { AccountCoverage, ComparisonCoverage, Period } from "@repo/contracts/finance";
import { addDays, periodLabel } from "@repo/finance";

const list = new Intl.ListFormat("en-AU", { type: "conjunction" });
const dayMonth = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

// A line about records that are missing, marked with the outflow ring.
export function RecordsNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="type-small text-intaglio">
      <span
        aria-hidden
        className="mr-1.5 inline-block size-2 rounded-full border-[1.5px] border-outflow"
      />
      {children}
    </p>
  );
}

// Says which records the comparison lacks, so days without records are never read as
// no spending.
export function ComparisonCoverageNote({
  coverage,
  comparison,
}: {
  coverage: ComparisonCoverage;
  comparison: Period;
}) {
  if (coverage.state === "complete") return null;
  if (coverage.state === "missing")
    return (
      <RecordsNote>There are no records for {periodLabel(comparison)} to compare with.</RecordsNote>
    );
  return (
    <>
      {coverage.gaps.map((gap) => (
        <RecordsNote key={gap.account.id}>
          {gap.account.label} has no records for {list.format(gap.missing.map(periodLabel))}, so the
          comparison leaves those days out.
        </RecordsNote>
      ))}
    </>
  );
}

// Says when the last records in the period end before it does, so its totals are not
// read as whole.
export function IncompleteRecordsNote({
  coverage,
  period,
  label,
}: {
  coverage: readonly AccountCoverage[];
  period: Period;
  label: string;
}) {
  const end = coverage
    .flatMap((item) => item.observed.map((interval) => interval.endExclusive))
    .filter((date) => date > period.start)
    .toSorted()
    .at(-1);
  if (!end || end >= period.endExclusive) return null;
  return (
    <RecordsNote>
      Your records stop on {dayMonth.format(Date.parse(addDays(end, -1)))}, so {label} is
      incomplete. Upload later statements to finish it.
    </RecordsNote>
  );
}
