import type { RecordLink } from "@repo/contracts/analyst";
import type { MonthsSelection } from "@repo/contracts/finance";
import { monthsDates } from "@repo/finance";
import { linkOptions } from "@tanstack/react-router";

import { countedSearch } from "@/features/ledger/search";
import { spendingSearch } from "@/features/spending/search";
import { comparisonKey, periodKey } from "@/lib/period";

const monthsKey = ({ from, to }: MonthsSelection) => periodKey(from, to);

// The address of the screen that shows a figure's number or a record, built as that
// screen builds its own links. A link that names months sets the period and the
// comparison, so it opens the same number whatever the address held before: `compare` is
// set even when undefined, because the root keeps a retained key the address leaves out.
// A posting ledger link also sets the months' first and last days, which the ledger
// otherwise drops for one file or question.
export function recordLink(records: RecordLink) {
  switch (records.kind) {
    case "overview":
      return linkOptions({
        to: "/",
        search: { period: monthsKey(records.period), compare: comparisonKey(records.comparison) },
      });
    case "spending":
      return linkOptions({
        to: "/spending",
        search: {
          period: monthsKey(records.period),
          compare: comparisonKey(records.comparison),
          ...spendingSearch(records, {
            tag: records.tagId,
            personalEvent: records.personalEventId,
          }),
        },
      });
    case "countedLedger":
      return linkOptions({
        to: "/ledger",
        search: {
          period: monthsKey(records.period),
          ...countedSearch(records.scope),
          ...records.filter,
        },
      });
    case "postingLedger":
      return linkOptions({
        to: "/ledger",
        search: {
          period: monthsKey(records.period),
          ...records.filter,
          ...monthsDates(records.period.from, records.period.to),
        },
      });
    case "transaction":
      return linkOptions({ to: "/ledger/$id", params: { id: records.postingId } });
    case "counterparties":
      return linkOptions({
        to: "/counterparties",
        search: {
          period: monthsKey(records.period),
          direction: records.direction,
          search: records.search || undefined,
        },
      });
    case "counterparty":
      return linkOptions({
        to: "/counterparties/$counterpartyId",
        params: { counterpartyId: records.counterpartyId },
      });
    case "questions":
      return records.period === null
        ? linkOptions({ to: "/questions", search: {} })
        : linkOptions({
            to: "/questions",
            search: { scope: "period", period: monthsKey(records.period) },
          });
    case "sources":
      return linkOptions({ to: "/sources" });
  }
}
