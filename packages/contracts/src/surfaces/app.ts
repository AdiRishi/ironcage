import { RpcGroup } from "effect/unstable/rpc";

import {
  configureBankAccountRpc,
  confirmBankImportRpc,
  getBankAccountsRpc,
  getBankCoverageRpc,
  getImportHistoryRpc,
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
);
