import { Link } from "@tanstack/react-router";

import { buttonVariants } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { currentMonth, type PeriodChoice, type PeriodRecords } from "@/lib/period";

// A period screen with nothing to show says which files would fill it, rather than
// showing zeros.
export function NoRecords({
  records,
  period,
  timezone,
}: {
  records: Exclude<PeriodRecords, "recorded">;
  period: PeriodChoice;
  timezone: string;
}) {
  return (
    <Empty>
      <EmptyHeader>
        {records === "none" ? (
          <>
            <EmptyTitle>No records yet.</EmptyTitle>
            <EmptyDescription>
              The <Link to="/">overview</Link> lists which files to download from NetBank.
            </EmptyDescription>
          </>
        ) : (
          <>
            <EmptyTitle>No records for {period.label} yet.</EmptyTitle>
            <EmptyDescription>
              {period.to < currentMonth(timezone)
                ? `Upload the ${period.label} statements.`
                : `Export ${period.label} so far from NetBank as CSV and OFX, then upload both.`}
            </EmptyDescription>
          </>
        )}
      </EmptyHeader>
      <EmptyContent>
        <UploadFilesLink />
      </EmptyContent>
    </Empty>
  );
}

// The way to Sources wherever records are missing. It is a link, so assistive technology
// announces where it goes, styled as the action it leads to.
export function UploadFilesLink() {
  return (
    <Link to="/sources" className={buttonVariants()}>
      Upload files
    </Link>
  );
}
