import type { QueryClient } from "@tanstack/react-query";

export function invalidateImportRecords(client: QueryClient) {
  return client.invalidateQueries({
    predicate: (query) =>
      ["accounts", "postings", "posting", "reviews", "sourceFiles"].includes(
        String(query.queryKey[0]),
      ),
  });
}
