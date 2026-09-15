import { CommandId, type Import, type RetryImport } from "@repo/contracts/finance";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { useCommand } from "@/lib/use-command";

import { retryImport } from "./functions";

export function RetryImportButton({ item }: { item: Import }) {
  const client = useQueryClient();
  const { mutation, submit } = useCommand({
    mutationFn: (data: typeof RetryImport.Type) => retryImport({ data }),
    onSettled: () => client.invalidateQueries({ queryKey: ["imports"] }),
  });
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        disabled={mutation.isPending}
        onClick={() => {
          submit({
            commandId: CommandId.make(crypto.randomUUID()),
            importId: item.id,
            expectedVersion: item.version,
          });
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
