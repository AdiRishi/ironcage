import {
  formatDay,
  formatFullDay,
  formatSignedAud,
  type BankImportPreview,
  type ImportRowVerdict,
} from "@ironcage/domain";
import { Badge } from "@ironcage/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ironcage/ui/components/table";

import { Metric, PanelTitle } from "@/components/common/panels";
import { shortDigest } from "@/features/money/format";

const verdictTone = {
  New: "text-live",
  Duplicate: "text-ink-faint",
  Ambiguous: "text-warning",
} as const;

const reconciliation = {
  matched: { label: "Matched", tone: "live" as const },
  outside_covered_window: { label: "Outside covered window", tone: "default" as const },
  unavailable: { label: "No row balance", tone: "muted" as const },
};

/**
 * Everything the preview proved, before anything is written.
 *
 * The counts read as evidence rather than as a summary: source rows, the
 * transactions those rows resolve to, and what each row's verdict was. A row
 * the operator has to decide is drawn in the warning colour and is impossible
 * to confirm past without answering.
 */
export function ImportPreviewReport({ preview }: { readonly preview: BankImportPreview }) {
  const counts = tally(preview.verdicts);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Source rows" value={preview.logicalTransactionCount} />
        <Metric label="New" value={counts.New} tone={counts.New > 0 ? "live" : "muted"} />
        <Metric label="Already recorded" value={counts.Duplicate} tone="muted" />
        <Metric
          label="Needs a decision"
          value={counts.Ambiguous}
          tone={counts.Ambiguous > 0 ? "halted" : "muted"}
        />
      </div>

      <dl className="grid gap-x-8 gap-y-2 rounded-xl border bg-card p-4 text-sm sm:grid-cols-2">
        <Fact term="Account">
          {preview.account.label} · {preview.detectedProfile}
        </Fact>
        <Fact term="Source window">
          {formatFullDay(preview.window.start)} to {formatFullDay(preview.window.end)}
        </Fact>
        <Fact term="Source profile">{preview.sourceProfile}</Fact>
        <Fact term="Observations">{preview.observationCount}</Fact>
        <Fact term="Ledger balance">
          {formatSignedAud(preview.reconciliation.ledgerBalance)}{" "}
          <span className={toneClass(reconciliation[preview.reconciliation.balance].tone)}>
            {reconciliation[preview.reconciliation.balance].label}
          </span>
        </Fact>
        <Fact term="Needs a category">{preview.categoryReviewCount}</Fact>
        <Fact term="Bundle digest">
          <span className="font-mono text-xs">{shortDigest(preview.bundleDigest)}</span>
        </Fact>
        <Fact term="Files">
          <span className="font-mono text-xs">
            {preview.fileDigests
              .map((file) => `${file.role} ${shortDigest(file.digest)}`)
              .join(" · ")}
          </span>
        </Fact>
      </dl>

      <div className="flex flex-col gap-2">
        <PanelTitle>Coverage</PanelTitle>
        <div className="flex flex-col gap-1 rounded-xl border bg-card p-4 text-sm">
          {preview.coverage.added.length === 0 ? (
            <p className="text-muted-foreground">
              This window is already covered. The import adds evidence, not coverage.
            </p>
          ) : (
            preview.coverage.added.map((window) => (
              <p key={window.start} className="text-live">
                Adds {formatFullDay(window.start)} to {formatFullDay(window.end)}
              </p>
            ))
          )}
          {preview.coverage.retainedOverlap.map((window) => (
            <p key={`overlap-${window.start}`} className="text-muted-foreground">
              Overlaps {formatFullDay(window.start)} to {formatFullDay(window.end)}, already held
            </p>
          ))}
          {preview.coverage.gapsRemaining.map((gap) => (
            <p key={`${gap.accountId}-${gap.start}`} className="text-warning">
              Still missing {formatFullDay(gap.start)} to {formatFullDay(gap.end)} on another
              required account
            </p>
          ))}
        </div>
      </div>

      {preview.warnings.length > 0 && (
        <div className="flex flex-col gap-2">
          <PanelTitle>Warnings</PanelTitle>
          <ul className="flex flex-col gap-1 rounded-xl border bg-card p-4 text-sm text-warning">
            {preview.warnings.map((warning) => (
              <li key={warning.detail}>{warning.detail}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <PanelTitle>Row verdicts</PanelTitle>
        <div className="max-h-[26rem] overflow-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-right">#</TableHead>
                <TableHead className="w-24">Date</TableHead>
                <TableHead className="w-32 text-right">Amount</TableHead>
                <TableHead>Narrative</TableHead>
                <TableHead className="w-32">Verdict</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.verdicts.map((verdict) => (
                <TableRow key={verdict.sourceOrdinal} className="hover:bg-row-hover">
                  <TableCell className="text-right font-mono text-xs text-ink-faint tabular-nums">
                    {verdict.sourceOrdinal}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    {formatDay(verdict.postedDate)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatSignedAud(verdict.amount)}
                  </TableCell>
                  <TableCell className="max-w-md truncate text-xs" title={verdict.narrative}>
                    {verdict.narrative}
                  </TableCell>
                  <TableCell>
                    <Badge variant="ghost" className={verdictTone[verdict._tag]}>
                      {verdict._tag === "Duplicate" ? verdict.matchTier : verdict._tag}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

const toneClass = (tone: "live" | "default" | "muted") =>
  tone === "live" ? "text-live" : tone === "muted" ? "text-ink-faint" : "text-muted-foreground";

function Fact({ term, children }: { readonly term: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-1.5 last:border-0">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

const tally = (verdicts: readonly ImportRowVerdict[]) => {
  const counts = { New: 0, Duplicate: 0, Ambiguous: 0 };

  for (const verdict of verdicts) counts[verdict._tag] += 1;

  return counts;
};
