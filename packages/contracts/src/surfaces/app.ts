import { RpcGroup } from "effect/unstable/rpc";

import {
  categorizeTransactionsRpc,
  configureBankAccountRpc,
  confirmBankImportRpc,
  createCategoryRpc,
  decideTransferMatchRpc,
  editCategorizationRuleRpc,
  editCategoryRpc,
  getBankAccountsRpc,
  getBankCoverageRpc,
  getCategorizationRulesRpc,
  getImportHistoryRpc,
  getReviewQueueRpc,
  getTransferMatchesRpc,
  listCategoriesRpc,
  previewBankImportRpc,
} from "./money";
import { systemPingRpc } from "./system";

/** Served by core, called by the app. The operator surface. */
export const AppRpcs = RpcGroup.make(
  systemPingRpc,
  previewBankImportRpc,
  confirmBankImportRpc,
  getBankAccountsRpc,
  configureBankAccountRpc,
  getBankCoverageRpc,
  getImportHistoryRpc,
  listCategoriesRpc,
  createCategoryRpc,
  editCategoryRpc,
  getCategorizationRulesRpc,
  editCategorizationRuleRpc,
  categorizeTransactionsRpc,
  getReviewQueueRpc,
  getTransferMatchesRpc,
  decideTransferMatchRpc,
);
