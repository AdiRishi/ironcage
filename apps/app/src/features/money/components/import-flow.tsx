import {
  type BankAccount,
  BankImportPreview,
  ConfirmedBankImport,
  formatFullDay,
  type ImportRowVerdict,
} from "@ironcage/domain";
import { Alert, AlertDescription, AlertTitle } from "@ironcage/ui/components/alert";
import { Badge } from "@ironcage/ui/components/badge";
import { Button } from "@ironcage/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@ironcage/ui/components/empty";
import { Input } from "@ironcage/ui/components/input";
import { Label } from "@ironcage/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ironcage/ui/components/select";
import { Spinner } from "@ironcage/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { CallFailure, Panel, PanelSkeleton, PanelTitle } from "@/components/common/panels";
import { unwrap } from "@/data/core-call";
import { keys } from "@/data/keys";
import { ImportPreviewReport } from "@/features/money/components/import-preview";
import { RegisterAccount } from "@/features/money/components/register-account";
import { shortDigest } from "@/features/money/format";
import { accountsQuery, importHistoryQuery } from "@/features/money/queries";
import { newRequestId } from "@/lib/request-id";
import { confirmBankImport, previewBankImport } from "@/server/money";

/** An uploaded file in the form the contract carries it: base64 beside its name. */
export interface UploadedFile {
  readonly name: string;
  readonly mediaType: string;
  readonly bytes: string;
}

export const readUpload = async (file: File, mediaType: string): Promise<UploadedFile> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return { name: file.name, mediaType, bytes: btoa(binary) };
};

type Decision =
  | { readonly _tag: "New" }
  | { readonly _tag: "Existing"; readonly transactionId: string };

/** `null` is unanswered, which is not the same as answering "a new transaction". */
interface Answer {
  readonly ambiguityId: string;
  readonly decision: Decision | null;
}

const isAmbiguous = (
  verdict: ImportRowVerdict,
): verdict is Extract<ImportRowVerdict, { _tag: "Ambiguous" }> => verdict._tag === "Ambiguous";

/**
 * The import flow, in the order the chapter puts it: choose the account and its
 * two files, preview against the record, answer whatever the preview could not
 * decide, then confirm.
 *
 * Preview writes nothing. Confirm resends the same bytes with the digest and
 * fingerprint the preview reported, so core can refuse a confirm whose files or
 * whose record moved underneath it.
 */
export function ImportFlow() {
  const accounts = useQuery(accountsQuery);
  const history = useQuery(importHistoryQuery);

  if (accounts.isPending) return <PanelSkeleton rows={5} />;
  if (accounts.isError) return <CallFailure error={accounts.error} />;

  return (
    <div className="flex flex-col gap-7">
      <RegisterAccount taken={accounts.data.map((account) => account.profile)} />

      {accounts.data.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No bank account is configured</EmptyTitle>
            <EmptyDescription>
              An import is interpreted by the profile of the account it belongs to, so an account
              has to exist before a file can mean anything.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <StructuredImport accounts={accounts.data} />
      )}

      <Panel title="Confirmed imports">
        {history.isPending ? (
          <PanelSkeleton rows={2} />
        ) : history.isError ? (
          <CallFailure error={history.error} />
        ) : history.data.length === 0 ? (
          <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
            Nothing has been imported yet.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-xl border bg-card">
            {history.data.map((item) => (
              <li
                key={item.importId}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-border/60 p-4 text-sm last:border-0 hover:bg-row-hover"
              >
                <span className="font-mono text-xs tabular-nums">
                  {formatFullDay(item.window.start)} → {formatFullDay(item.window.end)}
                </span>
                <span className="text-muted-foreground">
                  {item.sourceTransactions} rows · {item.newTransactions} new · {item.duplicates}{" "}
                  already held
                </span>
                <span className="font-mono text-xs text-ink-faint">
                  {shortDigest(item.bundleDigest)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function StructuredImport({ accounts }: { readonly accounts: readonly BankAccount[] }) {
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [csv, setCsv] = useState<UploadedFile | null>(null);
  const [ofx, setOfx] = useState<UploadedFile | null>(null);
  const [answers, setAnswers] = useState<readonly Answer[]>([]);

  const source =
    csv === null || ofx === null
      ? null
      : { kind: "commbank_structured" as const, accountId, csv, ofx };

  const preview = useMutation({
    mutationFn: async (bundle: NonNullable<typeof source>) =>
      unwrap(BankImportPreview)(await previewBankImport({ data: { source: bundle } })),
    onSuccess: (result) => {
      setAnswers(
        result.verdicts
          .filter(isAmbiguous)
          .map((verdict) => ({ ambiguityId: verdict.id, decision: null })),
      );
    },
  });

  const confirm = useMutation({
    mutationFn: async (input: {
      readonly bundle: NonNullable<typeof source>;
      readonly report: BankImportPreview;
      readonly decided: readonly { readonly ambiguityId: string; readonly decision: Decision }[];
    }) =>
      unwrap(ConfirmedBankImport)(
        await confirmBankImport({
          data: {
            source: input.bundle,
            expectedBundleDigest: input.report.bundleDigest,
            expectedPreviewFingerprint: input.report.previewFingerprint,
            resolutions: input.decided,
            requestId: newRequestId(),
          },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.money() }),
  });

  const ambiguities = (preview.data?.verdicts ?? []).filter(isAmbiguous);
  const decided = answers.flatMap((answer) =>
    answer.decision === null
      ? []
      : [{ ambiguityId: answer.ambiguityId, decision: answer.decision }],
  );
  const answered = decided.length === answers.length;

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Recent history — one CSV and its OFX">
        <div className="flex flex-col gap-4 rounded-xl border bg-card p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="account">Account</Label>
              <Select
                value={accountId}
                onValueChange={(value) => value !== null && setAccountId(value)}
              >
                <SelectTrigger id="account">
                  <SelectValue placeholder="Choose an account">
                    {(value) => {
                      const account = accounts.find((candidate) => candidate.id === value);

                      return account === undefined
                        ? "Choose an account"
                        : `${account.label} ···${account.maskedSuffix}`;
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.label} ···{account.maskedSuffix}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <FilePicker
              id="csv"
              label="CSV export"
              accept=".csv,text/csv"
              chosen={csv}
              onChoose={(file) => void readUpload(file, "text/csv").then(setCsv)}
            />
            <FilePicker
              id="ofx"
              label="OFX export"
              accept=".ofx"
              chosen={ofx}
              onChoose={(file) => void readUpload(file, "application/x-ofx").then(setOfx)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={source === null || preview.isPending}
              onClick={() => {
                if (source !== null) preview.mutate(source);
              }}
            >
              {preview.isPending && <Spinner />}
              Preview
            </Button>
            <p className="text-xs text-muted-foreground">
              Preview reads the record and writes nothing. Both files must describe the same rows.
            </p>
          </div>
        </div>
      </Panel>

      {preview.isError && <CallFailure error={preview.error} />}

      {preview.data !== undefined && (
        <>
          <ImportPreviewReport preview={preview.data} />

          {ambiguities.length > 0 && (
            <div className="flex flex-col gap-2">
              <PanelTitle>Rows needing a decision</PanelTitle>
              <div className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-card p-4">
                <p className="text-sm text-muted-foreground">
                  The evidence left more than one reading. Each row is counted once, and which
                  transaction it belongs to is yours to say.
                </p>
                {ambiguities.map((verdict) => (
                  <AmbiguityChoice
                    key={verdict.id}
                    verdict={verdict}
                    chosen={
                      answers.find((answer) => answer.ambiguityId === verdict.id)?.decision ?? null
                    }
                    onChoose={(decision) =>
                      setAnswers((current) =>
                        current.map((answer) =>
                          answer.ambiguityId === verdict.id ? { ...answer, decision } : answer,
                        ),
                      )
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {confirm.isError && <CallFailure error={confirm.error} />}

          {confirm.data === undefined ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={source === null || confirm.isPending || !answered}
                onClick={() => {
                  if (source !== null && preview.data !== undefined) {
                    confirm.mutate({ bundle: source, report: preview.data, decided });
                  }
                }}
              >
                {confirm.isPending && <Spinner />}
                Confirm import
              </Button>
              <p className="text-xs text-muted-foreground">
                {answered
                  ? "Confirm resends these exact bytes. If the record moved since the preview, core refuses and the preview runs again."
                  : "Answer every row above before confirming."}
              </p>
            </div>
          ) : (
            <Alert className="border-live/40">
              <AlertTitle className="text-live">Imported</AlertTitle>
              <AlertDescription>
                {confirm.data.newTransactions} new transactions, {confirm.data.duplicates} already
                held, and {confirm.data.observations} observations recorded from{" "}
                {confirm.data.sourceTransactions} source rows.
              </AlertDescription>
            </Alert>
          )}
        </>
      )}
    </div>
  );
}

function AmbiguityChoice({
  verdict,
  chosen,
  onChoose,
}: {
  readonly verdict: Extract<ImportRowVerdict, { _tag: "Ambiguous" }>;
  readonly chosen: Decision | null;
  readonly onChoose: (decision: Decision) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-panel-2 p-3">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="truncate" title={verdict.narrative}>
          {verdict.narrative}
        </span>
        <span className="font-mono text-xs whitespace-nowrap tabular-nums">
          {formatFullDay(verdict.postedDate)}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={chosen?._tag === "New" ? "default" : "outline"}
          onClick={() => onChoose({ _tag: "New" })}
        >
          A new transaction
        </Button>
        {verdict.candidateTransactionIds.map((candidate) => (
          <Button
            key={candidate}
            size="sm"
            variant={
              chosen?._tag === "Existing" && chosen.transactionId === candidate
                ? "default"
                : "outline"
            }
            onClick={() => onChoose({ _tag: "Existing", transactionId: candidate })}
            className="font-mono text-xs"
          >
            {candidate.slice(-8)}
          </Button>
        ))}
      </div>
    </div>
  );
}

function FilePicker({
  id,
  label,
  accept,
  chosen,
  onChoose,
}: {
  readonly id: string;
  readonly label: string;
  readonly accept: string;
  readonly chosen: UploadedFile | null;
  readonly onChoose: (file: File) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="file"
        accept={accept}
        onChange={(event) => {
          const file = event.target.files?.[0];

          if (file !== undefined) onChoose(file);
        }}
      />
      {chosen !== null && (
        <Badge variant="ghost" className="self-start font-mono text-xs text-ink-faint">
          {chosen.name}
        </Badge>
      )}
    </div>
  );
}
