import { useSuspenseQuery, useSuspenseInfiniteQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { settingsQueryOptions } from "@/features/settings/queries";

import { ImportRecord } from "./import-record";
import { importsQueryOptions } from "./queries";
import { UploadFiles } from "./upload-files";
import { useImportCompletion } from "./use-import-completion";
export function ImportsPage() {
  const history = useSuspenseInfiniteQuery(importsQueryOptions());
  const imports = history.data.pages.flat();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  useImportCompletion(imports);
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
              <ImportRecord key={item.id} item={item} timezone={settings.timezone} />
            ))}
          </ul>
        )}
        {history.hasNextPage && (
          <Button
            className="mt-4"
            variant="outline"
            disabled={history.isFetchingNextPage}
            onClick={() => {
              history.fetchNextPage().catch(reportError);
            }}
          >
            Load older imports
          </Button>
        )}
      </section>
    </div>
  );
}
