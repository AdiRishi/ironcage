import { type Import } from "@repo/contracts/finance";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export function useImportCompletion(imports: ReadonlyArray<Import>) {
  const client = useQueryClient();
  const completedVersions = imports
    .filter((item) => item.status !== "processing")
    .map((item) => `${item.id}:${item.version}`)
    .join("/");
  useEffect(() => {
    if (completedVersions)
      client
        .invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] === "accounts" ||
            query.queryKey[0] === "postings" ||
            query.queryKey[0] === "posting" ||
            query.queryKey[0] === "reviews" ||
            query.queryKey[0] === "sourceFiles",
        })
        .catch(reportError);
  }, [client, completedVersions]);
}
