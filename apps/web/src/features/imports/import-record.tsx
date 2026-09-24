import { type Import } from "@repo/contracts/finance";
import { Link } from "@tanstack/react-router";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

import { RetryImportButton } from "./retry-import";

export const importStatusLabels: Record<Import["status"], string> = {
  processing: "Processing",
  needs_review: "Needs review",
  complete: "Complete",
  failed: "Failed",
};

export function ImportRecord({ item, timezone }: { item: Import; timezone: string }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-4 p-5">
      <div className="min-w-0 space-y-2">
        <p className="font-medium break-all">{item.fileName}</p>
        <p className="type-small text-slate">
          {item.format.toUpperCase()} ·{" "}
          {new Intl.DateTimeFormat("en-AU", {
            timeZone: timezone,
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(item.createdAt))}
        </p>
        {item.summary && (
          <p className="type-small text-slate">
            {item.summary.observations} source rows · {item.summary.newPostings} new ·{" "}
            {item.summary.matchedPostings} matched · {item.summary.reviewItems} to review
          </p>
        )}
        {item.summary?.pages && (
          <p className="type-small text-slate">
            {item.summary.pages.decoded} pages decoded · {item.summary.pages.needingReview.length}{" "}
            pages needing review
          </p>
        )}
        {item.failure && (
          <Alert variant="destructive">
            <AlertDescription>{item.failure.message}</AlertDescription>
          </Alert>
        )}
        {item.status === "failed" && <RetryImportButton item={item} />}
        {item.status === "needs_review" && (
          <Link
            to="/questions"
            search={{ importId: item.id }}
            className="mr-4 text-sm underline underline-offset-4"
          >
            Review source rows
          </Link>
        )}
        {item.summary && (
          <Link
            to="/ledger"
            search={{ importId: item.id }}
            className="text-sm underline underline-offset-4"
          >
            View transactions
          </Link>
        )}
      </div>
      <Badge variant={item.status === "failed" ? "destructive" : "secondary"}>
        {importStatusLabels[item.status]}
      </Badge>
    </li>
  );
}
