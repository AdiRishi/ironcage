import { RpcGroup } from "effect/unstable/rpc";

import { acknowledgeRpc, getFeedRpc } from "./feed";
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
  getMoneyAnalysisRpc,
  listTransactionsRpc,
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
  listTransactionsRpc,
  getTransferMatchesRpc,
  decideTransferMatchRpc,
  getMoneyAnalysisRpc,
  getFeedRpc,
  acknowledgeRpc,
);
