import { CommandId, type SourceFile, type RemoveSourceBytes } from "@repo/contracts/finance";
import { formatMoney } from "@repo/finance";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { postingsQueryOptions } from "@/features/transactions/queries";
import { useCommand } from "@/lib/use-command";

import { removeSourceBytes } from "./functions";

export function RemoveSourceDialog({ file }: { file: SourceFile }) {
  const [open, setOpen] = useState(false);
  const resultRef = useRef<HTMLOutputElement>(null);
  const client = useQueryClient();
  const postings = useQuery({
    ...postingsQueryOptions({ filter: { importId: file.importId } }),
    enabled: open,
  });
  const { mutation, submit, uncertain } = useCommand({
    mutationFn: (data: typeof RemoveSourceBytes.Type) => removeSourceBytes({ data }),
    onSuccess: () => setOpen(false),
    onSettled: () =>
      client.invalidateQueries({
        predicate: (query) =>
          ["sourceFiles", "posting", "reviews"].includes(String(query.queryKey[0])),
      }),
  });
  const failure = (mutation.error || postings.error)?.message;
  return (
    <div className="space-y-2">
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (value && !uncertain) mutation.reset();
          setOpen(value);
        }}
      >
        {(file.bytesAvailable || uncertain) && (
          <DialogTrigger render={<Button variant="outline" size="sm" />}>
            {uncertain ? "Retry removal" : "Remove bytes"}
            <span className="sr-only"> {file.fileName}</span>
          </DialogTrigger>
        )}
        <DialogContent
          finalFocus={mutation.isSuccess ? resultRef : true}
          className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
        >
          <DialogHeader>
            <DialogTitle>Remove original file bytes?</DialogTitle>
            <DialogDescription>
              {file.fileName} supports {file.postingCount.toLocaleString()} transactions. Their
              records, extracted evidence, coverage, and review decisions stay. Retained backups and
              your independent archive are unaffected.
            </DialogDescription>
          </DialogHeader>
          {postings.data && (
            <div className="space-y-3">
              <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
                {postings.data.rows.map((posting) => (
                  <li key={posting.id} className="flex justify-between gap-3 p-3 text-sm">
                    <Link
                      to="/transactions/$id"
                      params={{ id: posting.id }}
                      className="min-w-0 underline underline-offset-4"
                    >
                      {posting.postedOn} · {posting.description}
                    </Link>
                    <span className="shrink-0 font-mono">{formatMoney(posting.amount)}</span>
                  </li>
                ))}
              </ul>
              {postings.data.nextCursor && (
                <Link
                  to="/transactions"
                  search={{ importId: file.importId }}
                  className="text-sm underline"
                >
                  View all {file.postingCount.toLocaleString()} supported transactions
                </Link>
              )}
            </div>
          )}
          {failure && (
            <Alert variant="destructive">
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              disabled={mutation.isPending || postings.isPending || postings.isError}
              onClick={() =>
                submit({
                  commandId: CommandId.make(crypto.randomUUID()),
                  sourceFileId: file.id,
                  expectedVersion: file.version,
                })
              }
            >
              {mutation.isPending
                ? "Removing…"
                : uncertain
                  ? "Retry removal"
                  : "Remove original bytes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {!open && mutation.error && (
        <p role="alert" className="max-w-56 text-sm text-destructive">
          {mutation.error.message}
        </p>
      )}
      {mutation.isSuccess && (
        <output ref={resultRef} tabIndex={-1} className="block text-sm text-muted-foreground">
          Bytes removed. {mutation.data.affectedPostingCount} transactions retained.
        </output>
      )}
    </div>
  );
}
