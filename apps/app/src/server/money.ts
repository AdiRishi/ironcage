import { timeouts } from "@ironcage/contracts/client";
import type {
  BankImportSource,
  ImportSourcePayload,
  UploadedBytes,
  UploadPayload,
} from "@ironcage/contracts/schema";
import {
  BankAccountSummary,
  BankCoverage,
  CategorizePayload,
  CategorizeResult,
  CategorySummary,
  ConfigureAccountPayload,
  ConfirmBankImportResult,
  ConfirmPayload,
  CreateCategoryPayload,
  DecideTransferPayload,
  EditCategoryPayload,
  EditRulePayload,
  ImportHistoryEntry,
  PreviewBankImportResult,
  PreviewPayload,
  LedgerEntry,
  LedgerScope,
  MoneyAnalysis,
  RuleSummary,
  TransferMatchSummary,
  TransferMatches,
} from "@ironcage/contracts/schema";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { decodePayload, encodedRead, intoOutcome } from "@/server/boundary";
import { callCore } from "@/server/core.server";

const intoUpload = (upload: UploadPayload): UploadedBytes => ({
  displayName: upload.displayName,
  bytes: Uint8Array.from(atob(upload.base64), (char) => char.charCodeAt(0)),
});

const intoSource = (source: ImportSourcePayload): BankImportSource =>
  source.kind === "commbank_structured"
    ? {
        kind: source.kind,
        accountId: source.accountId,
        csv: intoUpload(source.csv),
        ofx: intoUpload(source.ofx),
      }
    : { kind: source.kind, accountId: source.accountId, pdf: intoUpload(source.pdf) };

export const getBankAccounts = createServerFn().handler(() =>
  callCore((client) => encodedRead(Schema.Array(BankAccountSummary))(client.getBankAccounts())),
);

export const getBankCoverage = createServerFn().handler(() =>
  callCore((client) => encodedRead(BankCoverage)(client.getBankCoverage())),
);

export const getImportHistory = createServerFn().handler(() =>
  callCore((client) => encodedRead(Schema.Array(ImportHistoryEntry))(client.getImportHistory())),
);

export const getMoneyAnalysis = createServerFn().handler(() =>
  callCore((client) => encodedRead(MoneyAnalysis)(client.getMoneyAnalysis())),
);

export const listCategories = createServerFn().handler(() =>
  callCore((client) => encodedRead(Schema.Array(CategorySummary))(client.listCategories())),
);

export const getCategorizationRules = createServerFn().handler(() =>
  callCore((client) => encodedRead(Schema.Array(RuleSummary))(client.getCategorizationRules())),
);

export const listTransactions = createServerFn({ method: "POST" })
  .validator(decodePayload(LedgerScope))
  .handler(({ data }) =>
    callCore((client) =>
      encodedRead(Schema.Array(LedgerEntry))(client.listTransactions({ scope: data })),
    ),
  );

export const getTransferMatches = createServerFn().handler(() =>
  callCore((client) => encodedRead(TransferMatches)(client.getTransferMatches())),
);

export const previewBankImport = createServerFn({ method: "POST" })
  .validator(decodePayload(PreviewPayload))
  .handler(({ data }) =>
    callCore(
      (client) =>
        intoOutcome(PreviewBankImportResult)(
          client.previewBankImport({ source: intoSource(data.source) }),
        ),
      { timeout: timeouts.appToCoreImport },
    ),
  );

export const confirmBankImport = createServerFn({ method: "POST" })
  .validator(decodePayload(ConfirmPayload))
  .handler(({ data }) =>
    callCore(
      (client) =>
        intoOutcome(ConfirmBankImportResult)(
          client.confirmBankImport({ ...data, source: intoSource(data.source) }),
        ),
      { timeout: timeouts.appToCoreImport },
    ),
  );

export const categorizeTransactions = createServerFn({ method: "POST" })
  .validator(decodePayload(CategorizePayload))
  .handler(({ data }) =>
    callCore((client) => intoOutcome(CategorizeResult)(client.categorizeTransactions(data))),
  );

export const decideTransferMatch = createServerFn({ method: "POST" })
  .validator(decodePayload(DecideTransferPayload))
  .handler(({ data }) =>
    callCore((client) => intoOutcome(TransferMatchSummary)(client.decideTransferMatch(data))),
  );

export const createCategory = createServerFn({ method: "POST" })
  .validator(decodePayload(CreateCategoryPayload))
  .handler(({ data }) =>
    callCore((client) => intoOutcome(CategorySummary)(client.createCategory(data))),
  );

export const editCategory = createServerFn({ method: "POST" })
  .validator(decodePayload(EditCategoryPayload))
  .handler(({ data }) =>
    callCore((client) => intoOutcome(CategorySummary)(client.editCategory(data))),
  );

export const configureBankAccount = createServerFn({ method: "POST" })
  .validator(decodePayload(ConfigureAccountPayload))
  .handler(({ data }) =>
    callCore((client) => intoOutcome(BankAccountSummary)(client.configureBankAccount(data))),
  );

export const editCategorizationRule = createServerFn({ method: "POST" })
  .validator(decodePayload(EditRulePayload))
  .handler(({ data }) =>
    callCore((client) => intoOutcome(RuleSummary)(client.editCategorizationRule(data))),
  );
