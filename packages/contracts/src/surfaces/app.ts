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
  retryCategorizationRpc,
} from "./money";
import { getReportRpc, listReportsRpc, markReportOpenedRpc } from "./reports";
import { getSystemStatusRpc, haltAllRpc, systemPingRpc } from "./system";
import { getWholeWealthRpc, listExternalAccountsRpc, recordExternalBalanceRpc } from "./wealth";

/** Served by core, called by the app. The operator surface. */
export const AppRpcs = RpcGroup.make(
  systemPingRpc,
  getSystemStatusRpc,
  haltAllRpc,
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
  retryCategorizationRpc,
  listTransactionsRpc,
  getTransferMatchesRpc,
  decideTransferMatchRpc,
  getMoneyAnalysisRpc,
  getFeedRpc,
  acknowledgeRpc,
  getWholeWealthRpc,
  listExternalAccountsRpc,
  recordExternalBalanceRpc,
  listReportsRpc,
  getReportRpc,
  markReportOpenedRpc,
);
