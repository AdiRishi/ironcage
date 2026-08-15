import type { BankAccountSummary } from "@ironcage/contracts/schema";
import { Alert, AlertDescription, AlertTitle } from "@ironcage/ui/components/alert";
import { Button } from "@ironcage/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@ironcage/ui/components/card";
import { Spinner } from "@ironcage/ui/components/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ironcage/ui/components/tabs";
import { cn } from "@ironcage/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { useReducer } from "react";

import { keys } from "@/data/keys";
import { blockGuidance } from "@/features/money/blocks";
import { AccountSetup } from "@/features/money/components/account-setup";
import { ImportPreviewPanel } from "@/features/money/components/import-preview";
import { describeError, formatSpan } from "@/features/money/format";
import {
  confirmUpload,
  type ConfirmImportDraft,
  type ImportSourceDraft,
  previewUpload,
} from "@/features/money/import-upload";
import {
  initialImportWorkflow,
  reduceImportWorkflow,
  selectedImportSource,
} from "@/features/money/import-workflow";
import { accountsQuery } from "@/features/money/queries";
import { decodeConfirmOutcome, decodePreviewOutcome } from "@/features/money/transport";
import { confirmBankImport, previewBankImport } from "@/server/money";

function FileSlot({
  label,
  hint,
  accept,
  file,
  onFile,
}: {
  readonly label: string;
  readonly hint: string;
  readonly accept: string;
  readonly file: File | null;
  readonly onFile: (file: File) => void;
}) {
  return (
    // The drop target is a convenience over the label's own file input, which stays operable.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <label
      className="flex cursor-pointer flex-col gap-1 rounded-lg border border-dashed border-input bg-surface px-4 py-3 transition-colors hover:border-ring/60 has-focus-visible:border-ring"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const dropped = event.dataTransfer.files.item(0);
        if (dropped !== null) onFile(dropped);
      }}
    >
      <span className="font-mono text-[11px] tracking-[0.14em] text-ink-faint uppercase">
        {label}
      </span>
      {file === null ? (
        <span className="text-sm text-muted-foreground">{hint}</span>
      ) : (
        <span className="font-mono text-sm text-foreground">
          {file.name}
          <span className="ml-2 text-xs text-muted-foreground">
            {Math.max(Math.round(file.size / 1024), 1)} KB
          </span>
        </span>
      )}
      <input
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(event) => {
          const chosen = event.target.files?.item(0) ?? null;
          if (chosen !== null) onFile(chosen);
        }}
      />
    </label>
  );
}

function AccountPicker({
  accounts,
  selected,
  onSelect,
}: {
  readonly accounts: readonly BankAccountSummary[];
  readonly selected: BankAccountSummary["id"] | null;
  readonly onSelect: (id: BankAccountSummary["id"]) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {accounts.map((account) => (
        <button
          key={account.id}
          type="button"
          aria-pressed={account.id === selected}
          onClick={() => onSelect(account.id)}
          className={cn(
            "flex flex-col gap-0.5 rounded-lg border px-4 py-3 text-left transition-colors",
            account.id === selected ? "border-ring bg-accent" : "border-border hover:bg-row-hover",
          )}
        >
          <span className="text-sm font-medium text-foreground">{account.productLabel}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {account.maskedSuffix === null
              ? "identity binds on first import"
              : `···${account.maskedSuffix}`}
          </span>
        </button>
      ))}
    </div>
  );
}

export function ImportWizard() {
  const queryClient = useQueryClient();
  const accounts = useQuery(accountsQuery);
  const [state, dispatch] = useReducer(reduceImportWorkflow, initialImportWorkflow);

  const preview = useMutation({
    mutationFn: async (source: ImportSourceDraft) =>
      decodePreviewOutcome(await previewBankImport({ data: previewUpload(source) })),
    onSuccess: (outcome, source) => {
      if (outcome.outcome === "ok") dispatch({ type: "previewed", source });
    },
  });

  const confirm = useMutation({
    mutationFn: async (input: ConfirmImportDraft) =>
      decodeConfirmOutcome(await confirmBankImport({ data: confirmUpload(input) })),
    onSuccess: async (outcome, input) => {
      if (outcome.outcome === "ok" && outcome.value.kind === "confirmed") {
        await queryClient.invalidateQueries({ queryKey: keys.moneyAll() });
        return;
      }
      // The record moved between preview and confirm; previewing again is the
      // contract's answer, so do it for the operator and say so.
      if (
        outcome.outcome === "error" &&
        (outcome.error._tag === "Stale" || outcome.error._tag === "Conflict")
      ) {
        dispatch({ type: "refreshing" });
        preview.mutate(input.source);
      }
    },
  });

  const startOver = () => {
    dispatch({ type: "reset" });
    preview.reset();
    confirm.reset();
  };

  const submitSelection = () => {
    if (state.stage !== "select") return;
    const source = selectedImportSource(state.selection);
    if (source === null) return;
    confirm.reset();
    preview.mutate(source);
  };

  const confirmed =
    confirm.data?.outcome === "ok" && confirm.data.value.kind === "confirmed"
      ? confirm.data.value
      : undefined;

  if (confirmed !== undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-base tracking-tight">
            <CircleCheckIcon className="size-5 text-live" />
            Import confirmed
          </CardTitle>
          <CardDescription>
            {confirmed.effects.new === 0
              ? "The record already held every row — nothing new was written."
              : `${confirmed.effects.new} new ${confirmed.effects.new === 1 ? "transaction" : "transactions"} joined the record; ${confirmed.effects.duplicate} arrived as further evidence for rows already counted. Rules have filed what they recognize; the AI is filing the rest now.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {confirmed.coverageAdded.length > 0 ? (
            <p className="font-mono text-xs text-muted-foreground">
              coverage added{" "}
              <span className="text-live">
                {confirmed.coverageAdded.map((span) => formatSpan(span)).join(" · ")}
              </span>
            </p>
          ) : (
            <p className="font-mono text-xs text-muted-foreground">
              no new coverage — the window was already complete
            </p>
          )}
        </CardContent>
        <CardFooter className="gap-2">
          <Button variant="outline" onClick={startOver}>
            Import another
          </Button>
          <Button
            nativeButton={false}
            render={<Link to="/money/transactions" search={{ view: "ai" }} />}
          >
            Inspect what the AI filed
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const blocked =
    preview.data?.outcome === "ok" && preview.data.value.kind === "blocked"
      ? preview.data.value.block
      : confirm.data?.outcome === "ok" && confirm.data.value.kind === "blocked"
        ? confirm.data.value.block
        : undefined;

  if (blocked !== undefined) {
    const guidance = blockGuidance[blocked.code];
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-base tracking-tight">
            <CircleAlertIcon className="size-5 text-destructive" />
            {guidance.title}
          </CardTitle>
          <CardDescription>{guidance.hint}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="rounded-lg bg-panel-2 px-3 py-2 font-mono text-xs text-muted-foreground">
            {blocked.code}: {blocked.detail}
          </p>
        </CardContent>
        <CardFooter>
          <Button variant="outline" onClick={startOver}>
            Start over
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const ready =
    preview.data?.outcome === "ok" && preview.data.value.kind === "ready"
      ? preview.data.value.preview
      : undefined;

  if (ready !== undefined && state.stage === "preview") {
    return (
      <ImportPreviewPanel
        // Remounting on a new fingerprint drops stale ambiguity decisions.
        key={ready.previewFingerprint}
        accountLabel={
          accounts.data?.find((account) => account.id === ready.accountId)?.productLabel ??
          "account"
        }
        preview={ready}
        source={state.source}
        confirming={confirm.isPending || preview.isPending}
        refreshedNotice={state.refreshed}
        confirmError={
          confirm.data?.outcome === "error" &&
          confirm.data.error._tag !== "Stale" &&
          confirm.data.error._tag !== "Conflict"
            ? confirm.data.error
            : confirm.error !== null
              ? confirm.error
              : undefined
        }
        onConfirm={(input) => confirm.mutate(input)}
        onStartOver={startOver}
      />
    );
  }

  const previewError =
    preview.data?.outcome === "error"
      ? describeError(preview.data.error)
      : preview.error !== null
        ? String(preview.error)
        : undefined;

  if (state.stage !== "select") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-base tracking-tight">
            The refreshed preview didn't run
          </CardTitle>
          <CardDescription>{previewError ?? "The import preview is unavailable."}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="outline" onClick={startOver}>
            Start over
          </Button>
        </CardFooter>
      </Card>
    );
  }
  const { selection } = state;
  const sourceReady = selectedImportSource(selection) !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base tracking-tight">Bring in bank files</CardTitle>
        <CardDescription>
          Nothing is stored until you confirm what the preview shows. Re-uploading the same files is
          always safe — the record counts each bank transaction once.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[11px] tracking-[0.14em] text-ink-faint uppercase">
            Account
          </span>
          {accounts.isPending ? (
            <p className="text-sm text-muted-foreground">Loading accounts…</p>
          ) : accounts.isError ? (
            <p className="text-sm text-destructive">
              Accounts unavailable — {String(accounts.error)}
            </p>
          ) : accounts.data.length === 0 ? (
            <AccountSetup existing={accounts.data} />
          ) : (
            <AccountPicker
              accounts={accounts.data}
              selected={selection.accountId}
              onSelect={(accountId) => dispatch({ type: "selectAccount", accountId })}
            />
          )}
        </div>
        <Tabs
          value={selection.mode}
          onValueChange={(value) =>
            dispatch({
              type: "selectMode",
              mode: value === "statement" ? "statement" : "structured",
            })
          }
        >
          <TabsList variant="line">
            <TabsTrigger value="structured">Recent export</TabsTrigger>
            <TabsTrigger value="statement">Statement PDF</TabsTrigger>
          </TabsList>
          <TabsContent value="structured" className="flex flex-col gap-2 pt-3">
            <p className="text-sm text-muted-foreground">
              Export CSV and OFX from NetBank for the same account and the same date window. The two
              must describe exactly the same rows.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <FileSlot
                label="CSV"
                hint="Drop the CSV here, or browse"
                accept=".csv,text/csv"
                file={selection.mode === "structured" ? selection.csv : null}
                onFile={(file) => dispatch({ type: "selectCsv", file })}
              />
              <FileSlot
                label="OFX"
                hint="Drop the OFX here, or browse"
                accept=".ofx"
                file={selection.mode === "structured" ? selection.ofx : null}
                onFile={(file) => dispatch({ type: "selectOfx", file })}
              />
            </div>
          </TabsContent>
          <TabsContent value="statement" className="flex flex-col gap-2 pt-3">
            <p className="text-sm text-muted-foreground">
              One PDF statement. Money extracts its rows, verifies its account and balance chain,
              and previews the history it can add before anything is stored.
            </p>
            <FileSlot
              label="PDF"
              hint="Drop the statement here, or browse"
              accept=".pdf,application/pdf"
              file={selection.mode === "statement" ? selection.pdf : null}
              onFile={(file) => dispatch({ type: "selectPdf", file })}
            />
          </TabsContent>
        </Tabs>
        {previewError === undefined ? null : (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>The preview didn't run</AlertTitle>
            <AlertDescription>{previewError}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter>
        <Button disabled={!sourceReady || preview.isPending} onClick={submitSelection}>
          {preview.isPending ? <Spinner /> : null}
          Preview import
        </Button>
      </CardFooter>
    </Card>
  );
}
