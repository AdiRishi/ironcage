import { AccountId, UploadResult } from "@repo/contracts/finance";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";
import { UploadCloud } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CreateAccountDialog } from "@/features/accounts/create-account";
import { accountsQueryOptions } from "@/features/accounts/queries";

type UploadState = {
  id: string;
  fileName: string;
  status: "uploading" | "uploaded" | "existing" | "failed";
  message: string;
};
const UploadFailure = Schema.Struct({ message: Schema.String });
export function UploadFiles() {
  const { data: accounts } = useSuspenseQuery(accountsQueryOptions());
  const client = useQueryClient();
  const [accountId, setAccountId] = useState<typeof AccountId.Type | null>(null);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [dragging, setDragging] = useState(false);
  async function uploadFiles(files: FileList | null) {
    if (!files) return;
    await Promise.all(
      Array.from(files, async (file) => {
        const id = crypto.randomUUID();
        setUploads((current) => [
          ...current,
          { id, fileName: file.name, status: "uploading", message: "Uploading…" },
        ]);
        function update(status: UploadState["status"], message: string) {
          setUploads((current) =>
            current.map((item) => (item.id === id ? { ...item, status, message } : item)),
          );
        }
        try {
          const body = new FormData();
          body.set("file", file);
          if (accountId) body.set("accountId", accountId);
          const response = await fetch("/uploads", { method: "POST", body });
          if (!response.ok) {
            const failure = Schema.decodeUnknownSync(UploadFailure)(await response.json());
            update("failed", failure.message);
            return;
          }
          const result = Schema.decodeUnknownSync(UploadResult)(await response.json());
          update(
            result.existing ? "existing" : "uploaded",
            result.existing ? "Original available. Records already imported." : "Uploaded",
          );
          await client.invalidateQueries({
            predicate: (query) =>
              ["imports", "accounts", "postings", "posting", "reviews", "sourceFiles"].includes(
                String(query.queryKey[0]),
              ),
          });
        } catch {
          update("failed", "Upload did not finish. Choose the file again to retry.");
        }
      }),
    );
  }
  return (
    <section className="rounded-lg border bg-card p-6">
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="upload-account">Account for these files</Label>
          <Select
            value={accountId}
            onValueChange={setAccountId}
            items={[
              { value: null, label: "Use the file’s bank identity" },
              ...accounts.map((account) => ({ value: account.id, label: account.label })),
            ]}
          >
            <SelectTrigger id="upload-account" className="min-w-60">
              <SelectValue placeholder="Use the file’s bank identity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>Use the file’s bank identity</SelectItem>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <CreateAccountDialog />
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        Choose an account for CSV. OFX and PDF can identify its account automatically; select an
        account you added manually to connect it.
      </p>
      <div
        className={`rounded-md border-2 border-dashed p-8 text-center ${dragging ? "border-primary bg-accent" : "border-border"}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          uploadFiles(event.dataTransfer.files).catch(reportError);
        }}
      >
        <UploadCloud className="mx-auto mb-4 size-8 text-primary" />
        <h2 className="text-lg font-medium">Drop your bank exports here</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          CommBank CSV, OFX and PDF. Up to 10 MB per file.
        </p>
        <Label className="mx-auto mt-5 flex max-w-sm flex-col gap-2">
          <span className="sr-only">Choose bank files</span>
          <Input
            type="file"
            accept=".csv,.ofx,.pdf"
            multiple
            onChange={(event) => {
              const files = event.target.files;
              uploadFiles(files).catch(reportError);
              event.target.value = "";
            }}
          />
        </Label>
      </div>
      {uploads.length > 0 && (
        <div className="mt-4 space-y-2" aria-live="polite">
          {uploads.map((item) => (
            <div key={item.id} className="flex flex-wrap justify-between gap-2 text-sm">
              <span className="break-all">{item.fileName}</span>
              <span
                className={item.status === "failed" ? "text-destructive" : "text-muted-foreground"}
              >
                {item.message}
              </span>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            disabled={uploads.some((item) => item.status === "uploading")}
            onClick={() => setUploads([])}
          >
            Dismiss upload messages
          </Button>
        </div>
      )}
    </section>
  );
}
