import type { QueryClient } from "@tanstack/react-query";

const publishedRecords = new Set([
  "imports",
  "accounts",
  "postings",
  "posting",
  "reviews",
  "sourceFiles",
]);

// Publication and review decisions can touch every record family at once.
export function invalidatePublishedRecords(client: QueryClient) {
  return client.invalidateQueries({
    predicate: (query) => publishedRecords.has(String(query.queryKey[0])),
  });
}
