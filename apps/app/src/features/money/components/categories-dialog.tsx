import type { CategorySummary } from "@ironcage/contracts/schema";
import { newRequestId } from "@ironcage/domain";
import { Badge } from "@ironcage/ui/components/badge";
import { Button } from "@ironcage/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@ironcage/ui/components/dialog";
import { Input } from "@ironcage/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ironcage/ui/components/select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArchiveIcon, ArchiveRestoreIcon, LockIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";

import { keys } from "@/data/keys";
import { describeError } from "@/features/money/format";
import {
  decodeCategoryOutcome,
  encodeCreateCategoryPayload,
  encodeEditCategoryPayload,
} from "@/features/money/transport";
import { createCategory, editCategory } from "@/server/money";

/**
 * The taxonomy, editable in place. Uncategorized is system-owned and locked:
 * it is where pending review lives, so deleting it would hide unfinished
 * work rather than finish it.
 */
export function CategoriesDialog({
  categories,
}: {
  readonly categories: readonly CategorySummary[];
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [message, setMessage] = useState<string | undefined>(undefined);

  const settle = async (outcome: ReturnType<typeof decodeCategoryOutcome>) => {
    if (outcome.outcome === "error") {
      setMessage(describeError(outcome.error));
      return;
    }
    setMessage(undefined);
    await queryClient.invalidateQueries({ queryKey: keys.money("categories") });
  };

  const create = useMutation({
    mutationFn: async () =>
      decodeCategoryOutcome(
        await createCategory({
          data: encodeCreateCategoryPayload({
            requestId: newRequestId(),
            name: name.trim(),
            kind,
          }),
        }),
      ),
    onSuccess: async (outcome) => {
      if (outcome.outcome === "ok") setName("");
      await settle(outcome);
    },
  });

  const edit = useMutation({
    mutationFn: async (input: {
      readonly categoryId: CategorySummary["id"];
      readonly archived: boolean;
    }) =>
      decodeCategoryOutcome(
        await editCategory({
          data: encodeEditCategoryPayload({
            requestId: newRequestId(),
            categoryId: input.categoryId,
            name: null,
            archived: input.archived,
          }),
        }),
      ),
    onSuccess: settle,
  });

  const ordered = [...categories].sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "expense" ? -1 : 1,
  );

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            <SettingsIcon />
            Categories
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display tracking-tight">Categories</DialogTitle>
          <DialogDescription>
            Archiving hides a category from filing; history filed under it stays put.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {ordered.map((category) => (
            <div
              key={category.id}
              className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-row-hover"
            >
              <span className="flex items-center gap-2 text-sm">
                {category.name}
                <Badge variant="ghost" className="font-mono text-[10px] text-ink-faint">
                  {category.kind}
                </Badge>
                {category.archived ? (
                  <Badge variant="ghost" className="font-mono text-[10px] text-ink-faint">
                    archived
                  </Badge>
                ) : null}
              </span>
              {category.system ? (
                <LockIcon className="size-3.5 text-ink-faint" aria-label="System-owned" />
              ) : (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={
                    category.archived ? `Restore ${category.name}` : `Archive ${category.name}`
                  }
                  disabled={edit.isPending}
                  onClick={() =>
                    edit.mutate({ categoryId: category.id, archived: !category.archived })
                  }
                >
                  {category.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                </Button>
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t pt-4">
          <Input
            placeholder="New category"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && name.trim() !== "") create.mutate();
            }}
          />
          <Select
            value={kind}
            onValueChange={(value) => setKind(value === "income" ? "income" : "expense")}
          >
            <SelectTrigger size="sm" aria-label="Kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="expense">expense</SelectItem>
              <SelectItem value="income">income</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={name.trim() === "" || create.isPending}
            onClick={() => create.mutate()}
          >
            Add
          </Button>
        </div>
        {message === undefined ? null : <p className="text-sm text-destructive">{message}</p>}
      </DialogContent>
    </Dialog>
  );
}
