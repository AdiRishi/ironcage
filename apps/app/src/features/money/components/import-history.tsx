import type { ImportHistoryEntry } from "@ironcage/contracts/schema";
import { Badge } from "@ironcage/ui/components/badge";
import { Card, CardContent, CardDescription, CardHeader } from "@ironcage/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ironcage/ui/components/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ironcage/ui/components/tooltip";
import { DateTime } from "effect";

import { Eyebrow } from "@/features/money/components/eyebrow";
import { formatAgo, formatSpan } from "@/features/money/format";

export function ImportHistory({ entries }: { readonly entries: readonly ImportHistoryEntry[] }) {
  const recent = [...entries].sort(
    (a, b) => DateTime.toEpochMillis(b.confirmedAt) - DateTime.toEpochMillis(a.confirmedAt),
  );

  return (
    <Card>
      <CardHeader>
        <Eyebrow>Confirmed imports</Eyebrow>
        <CardDescription>
          Every source file stays attached to the record and can be re-uploaded safely — an
          identical bundle writes nothing new.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing confirmed yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Confirmed</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Window</TableHead>
                <TableHead className="text-right">New</TableHead>
                <TableHead className="text-right">Duplicates</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((entry) => (
                <TableRow key={entry.importId}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {formatAgo(entry.confirmedAt)}
                  </TableCell>
                  <TableCell>{entry.productLabel}</TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Badge variant="outline" className="font-mono text-[11px]">
                            {entry.sourceProfile === "cba-netbank-paired-v1"
                              ? "CSV + OFX"
                              : "Statement"}
                          </Badge>
                        }
                      />
                      <TooltipContent>
                        <div className="flex flex-col gap-0.5 font-mono text-xs">
                          {entry.files.map((file) => (
                            <span key={file.digest}>
                              {file.role}: {file.displayName} · {file.digest.slice(0, 12)}…
                            </span>
                          ))}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{formatSpan(entry.window)}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {entry.effects.new}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                    {entry.effects.duplicate}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
