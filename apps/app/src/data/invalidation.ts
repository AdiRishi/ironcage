import type { FeedEventType } from "@ironcage/domain";

import { keys } from "@/data/keys";

/**
 * The invalidation table from `docs/technical/11-app.md` §3, as one function
 * rather than a rule repeated at each call site. A feed event arrives, this
 * says which key prefixes it makes stale, and nothing else in the app decides
 * that.
 *
 * The prefixes are deliberately coarse. `["money"]` covers analysis, balances,
 * the review queue, and import history, because every money event can change
 * more than one of them and a partial invalidation that guesses wrong leaves a
 * financial number on screen that the record no longer agrees with.
 */
export const invalidatedBy = (eventType: FeedEventType): readonly (readonly string[])[] => {
  switch (eventType) {
    case "bank_import_completed":
    case "bank_gap_detected":
    case "bank_gap_closed":
    case "recurring_price_change":
    case "spending_anomaly":
      return [keys.money(), keys.vitals()];
    case "report_generated":
    case "report_failed":
      return [keys.reports(), keys.vitals()];
    case "ai_run_failed":
    case "decision_record_lost":
      return [keys.vitals()];
  }
};
