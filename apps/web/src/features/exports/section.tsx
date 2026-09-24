import { CommandId, type RequestExport } from "@repo/contracts/finance";
import { useForm } from "@tanstack/react-form";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useCommand } from "@/lib/use-command";

import { requestExport } from "./functions";
import { exportsQueryOptions } from "./queries";

export function ExportsSection({ timezone }: { timezone: string }) {
  const client = useQueryClient();
  const { data: exports, dataUpdatedAt } = useSuspenseQuery(exportsQueryOptions());
  const { mutation, submit, uncertain } = useCommand({
    mutationFn: (data: typeof RequestExport.Type) => requestExport({ data }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["exports"] }),
  });
  const form = useForm({
    defaultValues: { includeSources: false },
    onSubmit: ({ value }) => submit({ ...value, commandId: CommandId.make(crypto.randomUUID()) }),
  });
  return (
    <section className="space-y-5 rounded-lg border border-rule bg-sheet p-5">
      <div className="space-y-2">
        <h2 className="type-heading">Export your data</h2>
        <p className="type-small text-slate">
          Download every record as JSON with a manifest. Downloads expire after seven days.
        </p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          form.handleSubmit().catch(reportError);
        }}
      >
        <form.Field name="includeSources">
          {(field) => (
            <div className="flex items-center gap-3">
              <Checkbox
                id="include-sources"
                checked={field.state.value}
                onCheckedChange={field.handleChange}
                disabled={mutation.isPending || uncertain}
              />
              <Label htmlFor="include-sources">Include available original files</Label>
            </div>
          )}
        </form.Field>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Requesting…" : uncertain ? "Retry request" : "Request export"}
        </Button>
        {mutation.error && (
          <Alert variant="destructive">
            <AlertDescription>{mutation.error.message}</AlertDescription>
          </Alert>
        )}
      </form>
      {exports.length > 0 && (
        <ul className="divide-y border-t">
          {exports.map((item) => {
            const expired = item.expiresAt !== null && Date.parse(item.expiresAt) <= dataUpdatedAt;
            return (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="space-y-1 text-sm">
                  <p className="font-medium">
                    {new Intl.DateTimeFormat("en-AU", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: timezone,
                    }).format(new Date(item.requestedAt))}
                  </p>
                  <p className="text-slate">
                    {item.includeSources ? "Records and original files" : "Records only"}
                  </p>
                  {item.manifest && (
                    <p className="text-slate">
                      {item.manifest.tables.length} tables ·{" "}
                      {item.manifest.tables
                        .reduce((total, table) => total + table.count, 0)
                        .toLocaleString()}{" "}
                      records ·{" "}
                      {item.manifest.sources.filter((source) => source.path !== null).length} files
                    </p>
                  )}
                  {item.failure && (
                    <Alert variant="destructive">
                      <AlertDescription>{item.failure.message}</AlertDescription>
                    </Alert>
                  )}
                </div>
                {item.status === "ready" && !expired ? (
                  <a
                    className={buttonVariants({ variant: "outline" })}
                    href={`/exports/${item.id}`}
                  >
                    Download ZIP
                  </a>
                ) : (
                  <output className="type-small text-slate">
                    {expired ? "Expired" : item.status === "processing" ? "Preparing…" : "Failed"}
                  </output>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
