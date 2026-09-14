import { AppRequestError } from "@repo/contracts/app";
import { CommandId, type RequestExport } from "@repo/contracts/finance";
import { useForm } from "@tanstack/react-form";
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

import { listExports, requestExport } from "./functions";

export const exportsQueryOptions = () =>
  queryOptions({
    queryKey: ["exports"],
    queryFn: () => listExports(),
    refetchInterval: (query) =>
      query.state.data?.some((item) => item.status === "processing") ? 1500 : false,
  });

export function ExportsSection({ timezone }: { timezone: string }) {
  const client = useQueryClient();
  const { data: exports, dataUpdatedAt } = useSuspenseQuery(exportsQueryOptions());
  const mutation = useMutation({
    mutationFn: (data: typeof RequestExport.Type) => requestExport({ data }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["exports"] }),
  });
  const uncertain =
    mutation.error instanceof AppRequestError && mutation.error.code === "unavailable";
  const form = useForm({
    defaultValues: { includeSources: false },
    onSubmit: async ({ value }) => {
      await mutation
        .mutateAsync(
          uncertain && mutation.variables
            ? mutation.variables
            : { ...value, commandId: CommandId.make(crypto.randomUUID()) },
        )
        .catch(() => undefined);
    },
  });
  return (
    <section className="space-y-5 rounded-lg border p-5 sm:p-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Export your data</h2>
        <p className="text-sm text-muted-foreground">
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
          <p role="alert" className="text-sm text-destructive">
            {mutation.error.message}
          </p>
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
                  <p className="text-muted-foreground">
                    {item.includeSources ? "Records and original files" : "Records only"}
                  </p>
                  {item.manifest && (
                    <p className="text-muted-foreground">
                      {item.manifest.tables.length} tables ·{" "}
                      {item.manifest.tables
                        .reduce((total, table) => total + table.count, 0)
                        .toLocaleString()}{" "}
                      records ·{" "}
                      {item.manifest.sources.filter((source) => source.path !== null).length} files
                    </p>
                  )}
                  {item.failure && (
                    <p role="alert" className="text-destructive">
                      {item.failure.message}
                    </p>
                  )}
                </div>
                {item.status === "ready" && !expired ? (
                  <a
                    href={`/exports/${item.id}`}
                    className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-2"
                  >
                    Download ZIP
                  </a>
                ) : (
                  <output className="text-sm text-muted-foreground">
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
