import type { Money } from "@repo/contracts/finance";
import { formatCurrency } from "@repo/finance";
import { cn } from "cn";

// Every money value renders from its minor units, never from a float.
export function Amount({
  value,
  cents = true,
  signed = false,
  className,
}: {
  value: Money;
  cents?: boolean;
  signed?: boolean;
  className?: string;
}) {
  const text = formatCurrency(value, { cents });
  return (
    <span className={cn("tabular", className)}>
      {signed && value.minor > 0n ? `+${text}` : text}
    </span>
  );
}
