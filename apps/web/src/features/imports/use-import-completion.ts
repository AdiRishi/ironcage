import { type Import } from "@repo/contracts/finance";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

// Polling only refreshes the import rows, so everything a publication can change is
// refetched once an import stops processing. Reloading the route afterwards runs the
// root's default period again, so the first finished import moves the overview to the
// latest month with records.
export function useImportCompletion(imports: ReadonlyArray<Import>) {
  const client = useQueryClient();
  const router = useRouter();
  const completedVersions = imports
    .filter((item) => item.status !== "processing")
    .map((item) => `${item.id}:${item.version}`)
    .join("/");
  const previous = useRef(completedVersions);
  useEffect(() => {
    if (completedVersions !== previous.current)
      client
        .invalidateQueries()
        .then(() => router.invalidate())
        .catch(reportError);
    previous.current = completedVersions;
  }, [client, router, completedVersions]);
}
