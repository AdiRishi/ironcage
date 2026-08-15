import type { ExternalAccount, WholeWealth } from "@ironcage/contracts/schema";
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

import { ExternalBalanceForm } from "@/features/portfolio/components/external-balance-form";
import { ObservedAmount } from "@/features/portfolio/components/observed-amount";

export function WholeWealthView({
  wealth,
  accounts,
}: {
  readonly wealth: WholeWealth;
  readonly accounts: readonly ExternalAccount[];
}) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader>
          <CardTitle>Whole of wealth</CardTitle>
          <CardDescription>
            Imported Money balances and operator-recorded external balances.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between border-b pb-5">
            <span className="font-display text-lg font-semibold">Net worth</span>
            <ObservedAmount observed={wealth.netWorth} />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Balance date</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {wealth.positions.map((position) => (
                <TableRow key={`${position.source}:${position.id}`}>
                  <TableCell className="font-medium">{position.label}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{position.source}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {position.balanceDate ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <ObservedAmount observed={position.balance} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <ExternalBalanceForm accounts={accounts} />
    </div>
  );
}
