import type { GetAnalysis } from "@repo/contracts/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";

import { definitionSummary } from "./definition";
import { ComparisonResults } from "./results";
import { savedResultQuery } from "./saved-queries";

export function SavedAnalysisPage({ input }: { input: typeof GetAnalysis.Type }) {
  const result = useSuspenseQuery(savedResultQuery(input));
  const { analysis } = result.data;
  return (
    <div className="space-y-6">
      <Link className="text-sm underline" to="/trends/analyses">
        Saved analyses
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold">{analysis.name}</h1>
        <Button
          disabled={result.isFetching}
          onClick={() => {
            result.refetch().catch(reportError);
          }}
        >
          Refresh analysis
        </Button>
      </header>
      <p className="text-sm text-muted-foreground">{definitionSummary(analysis.definition)}</p>
      <p className="text-sm">
        Calculated when opened or refreshed. Results do not update automatically.
      </p>
      {result.error && (
        <p role="alert" className="text-destructive">
          Refresh failed. The previous result is still shown. {result.error.message}
        </p>
      )}
      <Link className="inline-block text-sm underline" to="/trends" search={analysis.definition}>
        Explore this comparison
      </Link>
      <ComparisonResults result={result.data.result} />
    </div>
  );
}
