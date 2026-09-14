import { AppRequestError } from "@repo/contracts/app";
import { CommandId, type Import, type RetryImport } from "@repo/contracts/finance";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";

import { retryImport } from "./functions";

export function RetryImportButton({ item }: { item: Import }) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (data: typeof RetryImport.Type) => retryImport({ data }),
    onSettled: () => client.invalidateQueries({ queryKey: ["imports"] }),
  });
  const uncertain =
    mutation.error instanceof AppRequestError && mutation.error.code === "unavailable";
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        disabled={mutation.isPending}
        onClick={() => {
          mutation.mutate(
            uncertain && mutation.variables
              ? mutation.variables
              : {
                  commandId: CommandId.make(crypto.randomUUID()),
                  importId: item.id,
                  expectedVersion: item.version,
                },
          );
        }}
      >
        {mutation.isPending ? "Starting…" : "Retry import"}
      </Button>
      {mutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {mutation.error.message}
        </p>
      )}
    </div>
  );
}
