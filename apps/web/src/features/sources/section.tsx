import type { Account, SourceFile } from "@repo/contracts/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { accountsQueryOptions } from "@/features/accounts/queries";
import { importStatusLabels } from "@/features/imports/import-record";
import { sourceHref } from "@/lib/sources";

import { sourceFilesQueryOptions } from "./queries";
import { RemoveSourceDialog } from "./remove-dialog";

const dates = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" });
const span = (file: SourceFile) =>
  file.firstOn && file.lastOn
    ? dates.formatRange(new Date(file.firstOn), new Date(file.lastOn))
    : "No transactions";

// Files grouped by the account they describe, newest records first.
export function SourceFilesSection() {
  const { data: files } = useSuspenseQuery(sourceFilesQueryOptions());
  const { data: accounts } = useSuspenseQuery(accountsQueryOptions());
  const groups: ReadonlyArray<{ account: Account | null; files: readonly SourceFile[] }> = [
    ...accounts.map((account) => ({
      account,
      files: files.filter((file) => file.accountId === account.id),
    })),
    { account: null, files: files.filter((file) => file.accountId === null) },
  ].filter((group) => group.files.length > 0);
  return (
    <section aria-labelledby="files-heading" className="space-y-4">
      <div>
        <h2 id="files-heading" className="type-heading">
          Files
        </h2>
        <p className="mt-1 type-small text-slate">
          Removing a file's bytes keeps its transactions. Uploading the same file again restores it.
        </p>
      </div>
      {groups.length === 0 ? (
        <p className="text-slate">No files yet.</p>
      ) : (
        <div className="divide-y divide-rule border-y border-rule">
          {groups.map((group) => (
            <details key={group.account?.id ?? "none"} className="group">
              <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4 py-3 hover:text-intaglio">
                <span className="flex items-baseline gap-2">
                  <span
                    aria-hidden
                    className="inline-block text-slate transition-transform group-open:rotate-90"
                  >
                    ›
                  </span>
                  <span className="font-[560]">{group.account?.label ?? "No account yet"}</span>
                </span>
                <span className="type-small text-slate">
                  {group.files.length} {group.files.length === 1 ? "file" : "files"}
                </span>
              </summary>
              <ul className="mb-3 divide-y divide-rule/70 border-t border-rule/70 type-small">
                {group.files.map((file) => (
                  <FileRow key={file.id} file={file} />
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

function FileRow({ file }: { file: SourceFile }) {
  return (
    <li className="grid items-center gap-x-4 gap-y-1 py-2 sm:grid-cols-[13rem_minmax(0,1fr)_auto_auto]">
      <span className="tabular">{span(file)}</span>
      <span className="min-w-0 truncate text-slate" title={file.fileName}>
        {file.format.toUpperCase()} · {file.fileName}
        {file.status !== "complete" && ` · ${importStatusLabels[file.status]}`}
      </span>
      <Link
        to="/ledger"
        search={{ importId: file.importId }}
        className="tabular underline-offset-4 hover:underline"
      >
        {file.postingCount.toLocaleString()} transactions
      </Link>
      <span className="flex items-center gap-3">
        {file.bytesAvailable ? (
          <a className="underline-offset-4 hover:underline" href={sourceHref(file.id)}>
            Open
          </a>
        ) : (
          <span className="text-slate">Removed</span>
        )}
        <RemoveSourceDialog file={file} />
      </span>
    </li>
  );
}
