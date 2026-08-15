import type { BankImportPreview, BoundaryError, CandidateEffect } from "@ironcage/contracts/schema";
import type { MatchTier } from "@ironcage/domain";
import { Alert, AlertDescription, AlertTitle } from "@ironcage/ui/components/alert";
import { Badge } from "@ironcage/ui/components/badge";
import { Button } from "@ironcage/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@ironcage/ui/components/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ironcage/ui/components/select";
import { Spinner } from "@ironcage/ui/components/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ironcage/ui/components/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ironcage/ui/components/tooltip";
import { cn } from "@ironcage/ui/lib/utils";
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { type ConfirmPayload, type PreviewPayload, mintRequestId } from "@/features/money/codec";
import { describeError, formatAud, formatDay, formatSpan } from "@/features/money/format";

export type SourceDraft = (typeof PreviewPayload)["Encoded"]["source"];
export type ConfirmDraft = (typeof ConfirmPayload)["Encoded"];

/** How each dedupe tier reads when the operator asks "why is this a duplicate?" */
const tierLabel: Record<MatchTier, string> = {
  bundle: "this exact bundle is already confirmed",
  identifier: "matched by its bank identifier",
  row_balance: "matched by date, amount, and running balance",
  content: "matched by date, amount, and narrative",
  statement: "aligned to existing history by statement evidence",
  new: "no stored evidence matches this row",
};

const profileLabel = {
  "cba-netbank-paired-v1": "CSV + OFX pair",
  "cba-offset-statement-v1": "Offset statement",
} as const;

function VerdictBadge({ candidate }: { readonly candidate: CandidateEffect }) {
  const badge =
    candidate.status === "new" ? (
      <Badge variant="outline" className="font-mono text-[11px]">
        new
      </Badge>
    ) : candidate.status === "duplicate" ? (
      <Badge variant="ghost" className="font-mono text-[11px] text-muted-foreground">
        duplicate
      </Badge>
    ) : (
      <Badge variant="outline" className="border-warning/60 font-mono text-[11px] text-warning">
        needs a decision
      </Badge>
    );

  return (
    <Tooltip>
      <TooltipTrigger render={badge} />
      <TooltipContent>
        {candidate.status === "ambiguous"
          ? `${candidate.options.length} stored ${candidate.options.length === 1 ? "transaction" : "transactions"} could be this row`
          : tierLabel[candidate.tier ?? "new"]}
        {candidate.narrativeVariant ? " · the narrative differs from the stored copy" : ""}
      </TooltipContent>
    </Tooltip>
  );
}

function EffectFigure({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[11px] tracking-[0.14em] text-ink-faint uppercase">
        {label}
      </span>
      <span className={cn("font-mono text-xl tabular-nums", value > 0 ? tone : undefined)}>
        {value}
      </span>
    </div>
  );
}

/**
 * Everything a confirm would write, before it writes. The digests shown are
 * the same ones confirm resends, so what the operator approves is
 * byte-identical to what lands.
 */
export function ImportPreviewPanel({
  preview,
  source,
  accountLabel,
  confirming,
  refreshedNotice,
  confirmError,
  onConfirm,
  onStartOver,
}: {
  readonly preview: BankImportPreview;
  readonly source: SourceDraft;
  readonly accountLabel: string;
  readonly confirming: boolean;
  readonly refreshedNotice: boolean;
  readonly confirmError?: BoundaryError | Error | undefined;
  readonly onConfirm: (input: ConfirmDraft) => void;
  readonly onStartOver: () => void;
}) {
  const [decisions, setDecisions] = useState<Record<number, string>>({});

  const ambiguous = preview.candidates.filter((candidate) => candidate.status === "ambiguous");
  const allResolved = ambiguous.every((candidate) => decisions[candidate.ordinal] !== undefined);

  const confirm = () =>
    onConfirm({
      source,
      expectedBundleDigest: preview.bundleDigest,
      expectedPreviewFingerprint: preview.previewFingerprint,
      resolutions: ambiguous.map((candidate) => {
        const decision = decisions[candidate.ordinal];
        return {
          ordinal: candidate.ordinal,
          decision:
            decision === undefined || decision === "new"
              ? { kind: "new" }
              : { kind: "link", transactionId: decision },
        };
      }),
      requestId: mintRequestId(),
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg tracking-tight">
          Preview — {accountLabel}
        </CardTitle>
        <CardDescription className="font-mono text-xs">
          {profileLabel[preview.sourceProfile]} · {formatSpan(preview.window)} ·{" "}
          {preview.files.map((file) => `${file.role} ${file.digest.slice(0, 8)}…`).join(" · ")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {refreshedNotice ? (
          <Alert>
            <RefreshCwIcon />
            <AlertTitle>The record moved on</AlertTitle>
            <AlertDescription>
              Something changed between preview and confirm, so this preview was recomputed. Check
              it and confirm again.
            </AlertDescription>
          </Alert>
        ) : null}
        {preview.alreadyConfirmed ? (
          <Alert>
            <InfoIcon />
            <AlertTitle>These exact files are already in the record</AlertTitle>
            <AlertDescription>
              Confirming again returns the earlier result and writes nothing new.
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <EffectFigure label="Rows read" value={preview.logicalTransactions} />
          <EffectFigure label="New" value={preview.effects.new} />
          <EffectFigure label="Duplicates" value={preview.effects.duplicate} />
          <EffectFigure label="Ambiguous" value={preview.effects.ambiguous} tone="text-warning" />
          <EffectFigure label="To review" value={preview.reviewCount} />
        </div>
        {preview.balances.ledger === null ? null : (
          <p className="font-mono text-xs text-muted-foreground">
            ledger <span className="text-foreground">{formatAud(preview.balances.ledger)}</span>
            {preview.balances.available === null ? null : (
              <>
                <span className="mx-2 text-ink-faint">·</span>available{" "}
                {formatAud(preview.balances.available)}
              </>
            )}
            <span className="mx-2 text-ink-faint">·</span>
            {preview.balances.ledgerReconciled ? (
              <span className="text-live">
                <CircleCheckIcon className="mr-1 inline size-3.5 align-[-2px]" />
                reconciled against the newest row
              </span>
            ) : (
              <span>not reconcilable from this window</span>
            )}
          </p>
        )}
        <div className="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
          <span>
            coverage added{" "}
            {preview.coverage.added.length === 0 ? (
              "none"
            ) : (
              <span className="text-live">
                {preview.coverage.added.map((span) => formatSpan(span)).join(" · ")}
              </span>
            )}
          </span>
          {preview.coverage.overlapRetained.length > 0 ? (
            <span>
              overlap re-proven{" "}
              {preview.coverage.overlapRetained.map((span) => formatSpan(span)).join(" · ")}
            </span>
          ) : null}
          {preview.coverage.gapsRemaining.length > 0 ? (
            <span>
              gaps remaining{" "}
              <span className="text-warning">
                {preview.coverage.gapsRemaining.map((span) => formatSpan(span)).join(" · ")}
              </span>
            </span>
          ) : null}
        </div>
        {preview.warnings.length > 0 ? (
          <Alert>
            <CircleAlertIcon className="text-warning" />
            <AlertTitle>Worth a look</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {preview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="max-h-[26rem] overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Posted</TableHead>
                <TableHead>Narrative</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Verdict</TableHead>
                <TableHead>Category</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.candidates.map((candidate) => (
                <TableRow key={candidate.ordinal}>
                  <TableCell className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                    {formatDay(candidate.postedDate)}
                  </TableCell>
                  <TableCell className="max-w-96">
                    <span className="block truncate text-sm" title={candidate.narrative}>
                      {candidate.payee === "" ? candidate.narrative : candidate.payee}
                    </span>
                    {candidate.payee === "" ? null : (
                      <span className="block truncate font-mono text-xs text-ink-faint">
                        {candidate.narrative}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm whitespace-nowrap tabular-nums">
                    {formatAud(candidate.amount, { sign: "always" })}
                  </TableCell>
                  <TableCell>
                    <VerdictBadge candidate={candidate} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {candidate.category ?? "Uncategorized"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {ambiguous.length > 0 ? (
          <div className="flex flex-col gap-3 rounded-lg border border-warning/40 p-4">
            <div>
              <h3 className="text-sm font-medium">
                {ambiguous.length} {ambiguous.length === 1 ? "row needs" : "rows need"} your
                decision
              </h3>
              <p className="text-sm text-muted-foreground">
                The record holds more than one plausible match. Nothing is dropped or double-counted
                silently — you decide, and the decision is kept.
              </p>
            </div>
            {ambiguous.map((candidate) => (
              <div
                key={candidate.ordinal}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <span className="font-mono text-xs">
                  {formatDay(candidate.postedDate)} ·{" "}
                  {formatAud(candidate.amount, { sign: "always" })} ·{" "}
                  <span className="text-muted-foreground">{candidate.narrative}</span>
                </span>
                <Select
                  value={decisions[candidate.ordinal] ?? null}
                  onValueChange={(value) => {
                    if (typeof value === "string") {
                      setDecisions((current) => ({ ...current, [candidate.ordinal]: value }));
                    }
                  }}
                >
                  <SelectTrigger size="sm" className="min-w-56 font-mono text-xs">
                    <SelectValue placeholder="Decide…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">
                      <span className="font-mono text-xs">A new transaction</span>
                    </SelectItem>
                    {candidate.options.map((transactionId) => (
                      <SelectItem key={transactionId} value={transactionId}>
                        <span className="font-mono text-xs">
                          The stored row ending …{transactionId.slice(-8)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        ) : null}
        {confirmError === undefined ? null : (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>The confirm didn't land</AlertTitle>
            <AlertDescription>{describeError(confirmError)}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button variant="outline" onClick={onStartOver} disabled={confirming}>
          Start over
        </Button>
        <Button onClick={confirm} disabled={!allResolved || confirming}>
          {confirming ? <Spinner /> : null}
          {preview.alreadyConfirmed ? "Confirm again — writes nothing" : "Confirm import"}
        </Button>
      </CardFooter>
    </Card>
  );
}
