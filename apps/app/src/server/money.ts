import type { BankImportSource, UploadedBytes } from "@ironcage/contracts/schema";
import {
  BankAccountSummary,
  BankCoverage,
  BoundaryError,
  CategorySummary,
  ConfirmBankImportResult,
  ImportHistoryEntry,
  MoneyAnalysis,
  PreviewBankImportResult,
  ReviewQueueEntry,
  RuleSummary,
  TransferMatchSummary,
} from "@ironcage/contracts/schema";
import { intoTaxonomy } from "@ironcage/contracts/client";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";
import type { RpcClientError } from "effect/unstable/rpc";

import {
  CategorizePayload,
  ConfirmPayload,
  CreateCategoryPayload,
  DecideTransferPayload,
  EditCategoryPayload,
  EditRulePayload,
  type ImportSourcePayload,
  PreviewPayload,
  TransferMatches,
  type UploadPayload,
} from "@/features/money/codec";
import { callCore } from "@/server/core";

const encodedRead = <S extends Schema.Codec<unknown, unknown>>(schema: S) => {
  const encode = Schema.encodeSync(schema);
  return <E, R>(effect: Effect.Effect<S["Type"], E | RpcClientError.RpcClientError, R>) =>
    intoTaxonomy(effect).pipe(Effect.map(encode));
};

const encodeBoundaryError = Schema.encodeSync(BoundaryError);

/** Fold a mutation's typed failure into data the route can branch on. */
const intoOutcome = <S extends Schema.Codec<unknown, unknown>>(schema: S) => {
  const encodeValue = Schema.encodeSync(schema);
  return <E extends BoundaryError, R>(
    effect: Effect.Effect<S["Type"], E | RpcClientError.RpcClientError, R>,
  ) =>
    intoTaxonomy(effect).pipe(
      Effect.map((value) => ({ outcome: "ok", value: encodeValue(value) }) as const),
      Effect.catch((error) =>
        Effect.succeed({ outcome: "error", error: encodeBoundaryError(error) } as const),
      ),
    );
};

const decodePayload =
  <S extends Schema.Codec<unknown, unknown>>(schema: S) =>
  (input: S["Encoded"]): S["Type"] =>
    Schema.decodeUnknownSync(schema)(input);

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

export const getReviewQueue = createServerFn().handler(() =>
  callCore((client) => encodedRead(Schema.Array(ReviewQueueEntry))(client.getReviewQueue())),
);

export const getTransferMatches = createServerFn().handler(() =>
  callCore((client) => encodedRead(TransferMatches)(client.getTransferMatches())),
);

export const previewBankImport = createServerFn({ method: "POST" })
  .inputValidator(decodePayload(PreviewPayload))
  .handler(({ data }) =>
    callCore((client) =>
      intoOutcome(PreviewBankImportResult)(
        client.previewBankImport({ source: intoSource(data.source) }),
      ),
    ),
  );

export const confirmBankImport = createServerFn({ method: "POST" })
  .inputValidator(decodePayload(ConfirmPayload))
  .handler(({ data }) =>
    callCore((client) =>
      intoOutcome(ConfirmBankImportResult)(
        client.confirmBankImport({ ...data, source: intoSource(data.source) }),
      ),
    ),
  );

const CategorizeResult = Schema.Struct({ updated: Schema.Int, rulesCreated: Schema.Int });

export const categorizeTransactions = createServerFn({ method: "POST" })
  .inputValidator(decodePayload(CategorizePayload))
  .handler(({ data }) =>
    callCore((client) => intoOutcome(CategorizeResult)(client.categorizeTransactions(data))),
  );

export const decideTransferMatch = createServerFn({ method: "POST" })
  .inputValidator(decodePayload(DecideTransferPayload))
  .handler(({ data }) =>
    callCore((client) => intoOutcome(TransferMatchSummary)(client.decideTransferMatch(data))),
  );

export const createCategory = createServerFn({ method: "POST" })
  .inputValidator(decodePayload(CreateCategoryPayload))
  .handler(({ data }) =>
    callCore((client) => intoOutcome(CategorySummary)(client.createCategory(data))),
  );

export const editCategory = createServerFn({ method: "POST" })
  .inputValidator(decodePayload(EditCategoryPayload))
  .handler(({ data }) =>
    callCore((client) => intoOutcome(CategorySummary)(client.editCategory(data))),
  );

export const editCategorizationRule = createServerFn({ method: "POST" })
  .inputValidator(decodePayload(EditRulePayload))
  .handler(({ data }) =>
    callCore((client) => intoOutcome(RuleSummary)(client.editCategorizationRule(data))),
  );
