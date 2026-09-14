import type { ParsedFile } from "@repo/contracts/finance";

export function reconcile({
  observations,
  statement,
}: Pick<ParsedFile, "observations" | "statement">) {
  const rows = observations.flatMap((observation) =>
    observation.candidate ? [observation.candidate] : [],
  );
  const ordered = statement.order === "descending" ? [...rows].reverse() : rows;
  const first = ordered[0];
  const last = ordered.at(-1);
  const opening =
    statement.opening ??
    (first?.balance
      ? {
          on: first.postedOn,
          money: {
            currency: first.amount.currency,
            minor: first.balance.minor - first.amount.minor,
          },
        }
      : null);
  const closing =
    statement.closing ?? (last?.balance ? { on: last.postedOn, money: last.balance } : null);
  const movement = rows.reduce((sum, row) => sum + row.amount.minor, 0n);
  const issues: string[] = [];
  if (opening && closing && opening.money.minor + movement !== closing.money.minor)
    issues.push("Opening balance plus movements does not equal closing balance.");
  let previous = opening?.money.minor;
  for (const row of ordered) {
    if (previous !== undefined && row.balance && previous + row.amount.minor !== row.balance.minor)
      issues.push("Running balances do not reconcile.");
    previous = row.balance?.minor;
  }
  if (
    statement.debitTotal &&
    -rows.reduce((sum, row) => sum + (row.amount.minor < 0n ? row.amount.minor : 0n), 0n) !==
      statement.debitTotal.minor
  )
    issues.push("Printed debits do not equal movements.");
  if (
    statement.creditTotal &&
    rows.reduce((sum, row) => sum + (row.amount.minor > 0n ? row.amount.minor : 0n), 0n) !==
      statement.creditTotal.minor
  )
    issues.push("Printed credits do not equal movements.");
  const dates = rows.map((row) => row.postedOn).sort();
  return {
    opening,
    closing,
    reconciled: opening !== null && closing !== null && issues.length === 0,
    observedStart: dates[0] ?? statement.statedStart,
    observedEnd: dates.at(-1) ?? statement.statedEnd,
    issues: [...new Set(issues)],
  };
}
