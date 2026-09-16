import { CommandId, type DeleteAnalysis, type SavedAnalysis } from "@repo/contracts/finance";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { useCommand } from "@/lib/use-command";

import { definitionSummary } from "./definition";
import { AnalysisNameDialog } from "./name-dialog";
import { deleteAnalysis } from "./saved-functions";
import { analysesQuery } from "./saved-queries";

function AnalysisItem({ analysis }: { analysis: SavedAnalysis }) {
  const client = useQueryClient();
  const command = useCommand({
    mutationFn: (data: typeof DeleteAnalysis.Type) => deleteAnalysis({ data }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["savedAnalyses"] });
    },
  });
  return (
    <li className="space-y-3 py-5">
      <Link
        className="text-lg font-medium underline underline-offset-4"
        to="/trends/$analysisId"
        params={{ analysisId: analysis.id }}
      >
        {analysis.name}
      </Link>
      <p className="text-sm text-muted-foreground">{definitionSummary(analysis.definition)}</p>
      <div className="flex flex-wrap gap-2">
        <AnalysisNameDialog action={{ kind: "rename", analysis }} />
        <Button
          variant="ghost"
          disabled={command.mutation.isPending}
          onClick={() =>
            command.submit({
              commandId: CommandId.make(crypto.randomUUID()),
              id: analysis.id,
              expectedVersion: analysis.version,
            })
          }
        >
          {command.uncertain ? "Retry delete" : "Delete analysis"}
        </Button>
      </div>
      {command.mutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {command.mutation.error.message}
        </p>
      )}
    </li>
  );
}
export function SavedAnalysesPage() {
  const { data } = useSuspenseQuery(analysesQuery());
  return (
    <div className="space-y-5">
      <Link className="text-sm underline" to="/trends">
        Back to Trends
      </Link>
      <h1 className="text-3xl font-semibold">Saved analyses</h1>
      <p className="text-muted-foreground">
        Open a saved question to calculate it against current records. Relative dates use your
        configured timezone.
      </p>
      {data.length ? (
        <ul className="divide-y">
          {data.map((analysis) => (
            <AnalysisItem key={analysis.id} analysis={analysis} />
          ))}
        </ul>
      ) : (
        <p>No saved analyses. Choose a comparison in Trends, then save it.</p>
      )}
    </div>
  );
}
