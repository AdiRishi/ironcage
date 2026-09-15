import {
  CommandId,
  EventChange,
  type EventId,
  type Correction,
  type UndoCorrection,
} from "@repo/contracts/finance";
import { financialRoleLabels } from "@repo/finance";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Effect, Schema } from "effect";

import { Button } from "@/components/ui/button";
import { useCommand } from "@/lib/use-command";

import { getCorrectionHistory, previewCorrection, undoCorrection } from "./functions";
import { ImpactTable } from "./impact";

export function EventHistory({ eventId }: { eventId: typeof EventId.Type }) {
  const history = useQuery({
    queryKey: ["corrections", eventId],
    queryFn: () => getCorrectionHistory({ data: { eventId } }),
  });
  return (
    <section className="space-y-4">
      <h3 className="font-semibold">Correction history</h3>
      {history.isPending && <output>Loading history…</output>}
      {history.error && (
        <p role="alert">
          {history.error.message}
          <Button
            variant="link"
            onClick={() => {
              history.refetch().catch(reportError);
            }}
          >
            Retry
          </Button>
        </p>
      )}
      {history.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">No corrections yet.</p>
      )}
      {history.data?.map((correction) => (
        <HistoryItem key={correction.id} correction={correction} />
      ))}
    </section>
  );
}
function HistoryItem({ correction }: { correction: typeof Correction.Type }) {
  const client = useQueryClient();
  const preview = useMutation({
    mutationFn: async () => {
      const change = await Effect.runPromise(
        Schema.decodeEffect(Schema.toType(EventChange))({
          eventId: correction.eventId,
          kind: correction.prior.kind,
          purchaseOn: correction.prior.purchaseOn,
          allocations: correction.prior.allocations,
        }),
      );
      return previewCorrection({
        data: { change: await Effect.runPromise(Schema.encodeEffect(EventChange)(change)) },
      });
    },
  });
  const { mutation, submit, uncertain } = useCommand({
    mutationFn: (data: typeof UndoCorrection.Type) => undoCorrection({ data }),
    onSuccess: async () => {
      preview.reset();
      await client.invalidateQueries();
    },
  });
  return (
    <article className="space-y-3 rounded-md border p-4">
      <p className="text-sm">
        {correction.createdAt} · {correction.scope === "undo" ? "Undo" : "Correction"} ·{" "}
        {financialRoleLabels[correction.prior.kind]} →{" "}
        {financialRoleLabels[correction.accepted.kind]} · {correction.accepted.allocations.length}{" "}
        allocations
      </p>
      <Button
        variant="outline"
        disabled={preview.isPending || mutation.isPending || uncertain}
        onClick={() => preview.mutate()}
      >
        {preview.isPending ? "Calculating…" : "Preview undo"}
      </Button>
      {preview.error && <p role="alert">{preview.error.message}</p>}
      {preview.data && (
        <>
          <ImpactTable impact={preview.data.impact} />
          <Button
            disabled={mutation.isPending}
            onClick={() => {
              if (preview.data)
                submit({
                  commandId: CommandId.make(crypto.randomUUID()),
                  correctionId: correction.id,
                  expectedVersions: preview.data.expectedVersions,
                });
            }}
          >
            {uncertain ? "Retry undo" : "Confirm undo"}
          </Button>
        </>
      )}
      {mutation.error && <p role="alert">{mutation.error.message}</p>}
    </article>
  );
}
