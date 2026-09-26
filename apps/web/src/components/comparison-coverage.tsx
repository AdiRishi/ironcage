import type { AccountCoverage, ComparisonCoverage, Period } from "@repo/contracts/finance";
import { periodGaps, periodLabel } from "@repo/finance";

const list = new Intl.ListFormat("en-AU", { type: "conjunction" });

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

// Names each account that has no records for some days of the period, and those days,
// so a total that leaves them out is not read as whole.
export function IncompleteRecordsNote({
  coverage,
  period,
  label,
}: {
  coverage: readonly AccountCoverage[];
  period: Period;
  label: string;
}) {
  return (
    <>
      {periodGaps(coverage, period).map((gap) => (
        <RecordsNote key={gap.account.id}>
          {gap.account.label} has no records for {list.format(gap.missing.map(periodLabel))}, so{" "}
          {label} is incomplete.
        </RecordsNote>
      ))}
    </>
  );
}
