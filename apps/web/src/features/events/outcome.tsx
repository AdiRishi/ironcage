import type { FinancialEvent, ReferenceData } from "@repo/contracts/finance";
import { financialRoleLabels } from "@repo/finance";

// Who a transaction is with, its role, and its categories as a change would leave them.
export function EventOutcome({
  event,
  references,
}: {
  event: FinancialEvent;
  references: typeof ReferenceData.Type;
}) {
  const counterparty = references.counterparties.find((item) => item.id === event.counterpartyId);
  const categories = [
    ...new Set(
      event.allocations.map(
        (allocation) =>
          references.categories.find((category) => category.id === allocation.categoryId)?.name ??
          "None",
      ),
    ),
  ];
  return (
    <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1">
      <dt className="text-slate">Counterparty</dt>
      <dd>{counterparty?.name ?? "Not identified"}</dd>
      <dt className="text-slate">Role</dt>
      <dd>{financialRoleLabels[event.kind]}</dd>
      <dt className="text-slate">Category</dt>
      <dd>{categories.join(", ")}</dd>
    </dl>
  );
}
