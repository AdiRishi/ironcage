import type { LedgerRow } from "@repo/contracts/finance";
import { cn } from "cn";

const labels = {
  you: "Set by you",
  rule: "Set by a rule",
  model: "Set by the model",
  bank: "From the bank's own record",
  none: "Not yet interpreted",
} as const;

// Who made an assignment, as a shape so it never depends on color alone: a solid dot
// for you or a rule, a hollow ring for the model, a red ring for an open question.
export function ProvenanceMark({
  assignedBy,
  question = false,
  className,
}: {
  assignedBy: LedgerRow["assignedBy"];
  question?: boolean;
  className?: string;
}) {
  if (!question && (assignedBy === "bank" || assignedBy === "none")) return null;
  const label = question ? "Waiting for your answer" : labels[assignedBy];
  return (
    <span title={label} className={cn("inline-flex shrink-0", className)}>
      <span
        aria-hidden
        className={cn(
          "inline-block size-2 rounded-full",
          question
            ? "border-[1.5px] border-attention"
            : assignedBy === "model"
              ? "border-[1.5px] border-slate"
              : "bg-intaglio",
        )}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
