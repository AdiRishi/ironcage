import type { RecurringCharge } from "@ironcage/contracts/schema";
import { Badge } from "@ironcage/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ironcage/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ironcage/ui/components/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ironcage/ui/components/tooltip";
import { BigDecimal } from "effect";

import { cadenceLabel, formatAud, formatDay } from "@/features/money/format";

export function RecurringCharges({
  recurring,
}: {
  readonly recurring: readonly RecurringCharge[];
}) {
  const ordered = [...recurring].sort((a, b) =>
    BigDecimal.Order(b.annualizedAmount, a.annualizedAmount),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg tracking-tight">Recurring charges</CardTitle>
        <CardDescription>
          Steady payees on a steady cadence — subscriptions and regular bills, with what they cost
          you a year.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {ordered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing qualifies yet. A charge needs three occurrences at a steady amount and cadence
            before it shows here.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payee</TableHead>
                <TableHead>Cadence</TableHead>
                <TableHead className="text-right">Typical</TableHead>
                <TableHead className="text-right">A year</TableHead>
                <TableHead>Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordered.map((charge) => (
                <TableRow key={charge.payee}>
                  <TableCell className="max-w-72">
                    <span className="block truncate text-sm">{charge.payee}</span>
                    {charge.priceChange === null ? null : (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Badge
                              variant="outline"
                              className="mt-0.5 border-warning/60 font-mono text-[10px] text-warning"
                            >
                              {formatAud(charge.priceChange.from, { sign: "none" })} →{" "}
                              {formatAud(charge.priceChange.to, { sign: "none" })}
                            </Badge>
                          }
                        />
                        <TooltipContent>
                          The price changed on {formatDay(charge.priceChange.on)}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {cadenceLabel(charge.cadenceDays)}
                    <span className="ml-1.5 font-mono text-xs text-ink-faint">
                      ×{charge.occurrences}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {formatAud(charge.medianAmount, { sign: "none" })}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {formatAud(charge.annualizedAmount, { sign: "none" })}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {formatDay(charge.lastSeen)}
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
