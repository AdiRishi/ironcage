import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";

import { Badge } from "@/components/ui/badge";

import { importsQueryOptions } from "./queries";
import { UploadFiles } from "./upload-files";
const statuses = {
  processing: "Processing",
  needs_review: "Needs review",
  complete: "Complete",
  failed: "Failed",
};
export function ImportsPage() {
  const { data: imports } = useSuspenseQuery(importsQueryOptions());
  const client = useQueryClient();
  const completedVersions = imports
    .filter((item) => item.status !== "processing")
    .map((item) => `${item.id}:${item.version}`)
    .join("/");
  useEffect(() => {
    if (completedVersions)
      client
        .invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] === "accounts" ||
            query.queryKey[0] === "postings" ||
            query.queryKey[0] === "posting",
        })
        .catch(reportError);
  }, [client, completedVersions]);
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Imports</h1>
        <p className="mt-2 text-muted-foreground">
          Bring in your bank history. Every transaction keeps its original evidence.
        </p>
      </header>
      <UploadFiles />
      <section>
        <h2 className="mb-4 text-xl font-semibold">Import history</h2>
        {imports.length === 0 ? (
          <p className="rounded-lg border p-8 text-center text-muted-foreground">
            Your imported files will appear here.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {imports.map((item) => (
              <li key={item.id} className="flex flex-wrap items-start justify-between gap-4 p-5">
                <div className="min-w-0 space-y-2">
                  <p className="font-medium break-all">{item.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.format.toUpperCase()} · {item.createdAt.slice(0, 10)}
                  </p>
                  {item.summary && (
                    <p className="text-sm text-muted-foreground">
                      {item.summary.observations} source rows · {item.summary.newPostings} new ·{" "}
                      {item.summary.matchedPostings} matched · {item.summary.reviewItems} to review
                    </p>
                  )}
                  {item.failure && (
                    <p role="alert" className="text-sm text-destructive">
                      {item.failure.message}
                    </p>
                  )}
                  {item.summary && (
                    <Link
                      to="/transactions"
                      search={{ importId: item.id }}
                      className="text-sm text-primary underline underline-offset-4"
                    >
                      View transactions
                    </Link>
                  )}
                </div>
                <Badge variant={item.status === "failed" ? "destructive" : "secondary"}>
                  {statuses[item.status]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
