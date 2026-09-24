import {
  AccountId,
  type ImportId,
  type Institution,
  institutionNames,
  UploadResult,
} from "@repo/contracts/finance";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Record, Schema } from "effect";
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

type UploadProgress =
  | { status: "uploading" | "failed"; message: string }
  | { status: "uploaded" | "existing"; message: string; importId: typeof ImportId.Type };
type UploadState = UploadProgress & {
  id: string;
  fileName: string;
};
const UploadResponse = Schema.Union([UploadResult, Schema.Struct({ message: Schema.String })]);
const fileIdentity = { value: null, label: "Use the file’s bank identity" };
export function UploadFiles() {
  const { data: accounts } = useSuspenseQuery(accountsQueryOptions());
  const client = useQueryClient();
  const [accountId, setAccountId] = useState<typeof AccountId.Type | null>(null);
  const [chosenInstitution, setInstitution] = useState<Institution>("commbank");
  // A file for a chosen account uses that account's bank.
  const institution =
    accounts.find((account) => account.id === accountId)?.institution ?? chosenInstitution;
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [dragging, setDragging] = useState(false);
  const accountItems = [
    fileIdentity,
    ...accounts.map((account) => ({ value: account.id, label: account.label })),
  ];
  async function uploadFiles(files: FileList | null) {
    if (!files) return;
    await Promise.all(
      Array.from(files, async (file) => {
        const id = crypto.randomUUID();
        setUploads((current) => [
          ...current,
          { id, fileName: file.name, status: "uploading", message: "Uploading…" },
        ]);
        function update(progress: UploadProgress) {
          setUploads((current) =>
            current.map((item) =>
              item.id === id ? { id, fileName: file.name, ...progress } : item,
            ),
          );
        }
        const body = new FormData();
        body.set("file", file);
        if (accountId) body.set("accountId", accountId);
        body.set("institution", institution);
        let result: typeof UploadResponse.Type;
        try {
          const response: unknown = await (
            await fetch("/uploads", { method: "POST", body })
          ).json();
          result = await Schema.decodeUnknownPromise(UploadResponse)(response);
        } catch {
          update({
            status: "failed",
            message: "Upload did not finish. Choose the file again to retry.",
          });
          return;
        }
        if ("message" in result) {
          update({ status: "failed", message: result.message });
          return;
        }
        update({
          status: result.existing ? "existing" : "uploaded",
          message: result.existing ? "Original available. Records already imported." : "Uploaded",
          importId: result.importId,
        });
        await client.invalidateQueries();
      }),
    );
  }
  return (
    <section className="rounded-lg border bg-card p-6">
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="upload-account">Account for these files</Label>
          <Select value={accountId} onValueChange={setAccountId} items={accountItems}>
            <SelectTrigger id="upload-account" className="min-w-60">
              <SelectValue placeholder={fileIdentity.label} />
            </SelectTrigger>
            <SelectContent>
              {accountItems.map((item) => (
                <SelectItem key={item.value ?? ""} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="upload-institution">Bank</Label>
          <Select
            value={institution}
            onValueChange={(value) => {
              if (value) setInstitution(value);
            }}
            items={institutionNames}
            disabled={accountId !== null}
          >
            <SelectTrigger id="upload-institution" className="min-w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Record.toEntries(institutionNames).map(([value, name]) => (
                <SelectItem key={value} value={value}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <CreateAccountDialog />
      </div>
      <p className="mb-5 type-small text-slate">
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
        <p className="mt-2 type-small text-slate">
          {institutionNames[institution]} CSV, OFX and PDF. Up to 10 MB per file.
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
              <span className={item.status === "failed" ? "text-destructive" : "text-slate"}>
                {item.message}
                {(item.status === "uploaded" || item.status === "existing") && (
                  <Link
                    to="/sources/imports/$importId"
                    params={{ importId: item.importId }}
                    className="ml-3 underline underline-offset-4"
                  >
                    View import
                  </Link>
                )}
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
