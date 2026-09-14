import { ImportId } from "@repo/contracts/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Schema } from "effect";

import { ImportRecord } from "@/features/imports/import-record";
import { importQueryOptions } from "@/features/imports/queries";
import { useImportCompletion } from "@/features/imports/use-import-completion";
import { settingsQueryOptions } from "@/features/settings/queries";

export const Route = createFileRoute("/imports/$importId")({
  params: { parse: ({ importId }) => ({ importId: Schema.decodeSync(ImportId)(importId) }) },
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(importQueryOptions(params.importId)),
      context.queryClient.ensureQueryData(settingsQueryOptions()),
    ]);
  },
  component: ImportDetail,
});

function ImportDetail() {
  const { importId } = Route.useParams();
  const { data: item } = useSuspenseQuery(importQueryOptions(importId));
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  useImportCompletion([item]);
  return (
    <div className="space-y-6">
      <Link to="/imports" className="text-sm text-primary underline underline-offset-4">
        All imports
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">Import details</h1>
      <ul className="rounded-lg border">
        <ImportRecord item={item} timezone={settings.timezone} />
      </ul>
    </div>
  );
}
