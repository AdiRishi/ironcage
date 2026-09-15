import { type Import } from "@repo/contracts/finance";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { invalidatePublishedRecords } from "@/lib/invalidate-records";

// Polling only refreshes the import rows, so dependent records are refetched
// once an import stops processing.
export function useImportCompletion(imports: ReadonlyArray<Import>) {
  const client = useQueryClient();
  const completedVersions = imports
    .filter((item) => item.status !== "processing")
    .map((item) => `${item.id}:${item.version}`)
    .join("/");
  const previous = useRef(completedVersions);
  useEffect(() => {
    if (completedVersions !== previous.current)
      invalidatePublishedRecords(client).catch(reportError);
    previous.current = completedVersions;
  }, [client, completedVersions]);
}
