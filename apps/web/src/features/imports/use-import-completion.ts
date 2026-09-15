import { type Import } from "@repo/contracts/finance";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { invalidateImportRecords } from "./invalidate-records";

export function useImportCompletion(imports: ReadonlyArray<Import>) {
  const client = useQueryClient();
  const completedVersions = imports
    .filter((item) => item.status !== "processing")
    .map((item) => `${item.id}:${item.version}`)
    .join("/");
  useEffect(() => {
    if (completedVersions) invalidateImportRecords(client).catch(reportError);
  }, [client, completedVersions]);
}
