import { queryOptions } from "@tanstack/react-query";

import { listSourceFiles } from "./functions";

export const sourceFilesQueryOptions = () =>
  queryOptions({ queryKey: ["sourceFiles"], queryFn: () => listSourceFiles() });
