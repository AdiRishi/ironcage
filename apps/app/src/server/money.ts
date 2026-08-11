import type { AppClient } from "@ironcage/contracts/client";
import { AppRpcs, clientOverBinding, intoTaxonomy, timeouts } from "@ironcage/contracts/client";
import { BoundaryError } from "@ironcage/contracts/schema";
import {
  AccountBalance,
  AmbiguityResolution,
  ArchivedBankStatement,
  BankAccount,
  BankAccountId,
  BankImportHistoryItem,
  BankImportPreview,
  BankImportSource,
  CalendarMonth,
  CategorizationReviewItem,
  Category,
  CategorizeTransactions,
  ConfirmedBankImport,
  MoneyAnalysis,
  MonthlySpendingReport,
  RegisterBankAccount,
  ReportId,
  RequestId,
  Sha256,
  UploadedBytes,
} from "@ironcage/domain";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import { appEnv } from "@/server/env";

/**
 * A core call's two outcomes, both serializable.
 *
 * `PreviewStale` and `ImportBytesChanged` are ordinary results of confirming an
 * import against a record that moved, and the operator needs to read them and
 * act. So a failure comes back encoded beside a success rather than thrown, and
 * the route decides what each one looks like.
 */
export type CoreOutcome<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: typeof BoundaryError.Encoded };

const encodeError = Schema.encodeSync(BoundaryError);

/** Effect stops at this boundary; the browser sees the encoded form of both sides. */
const callCore = <A, I>(
  schema: Schema.Codec<A, I>,
  use: (client: AppClient) => Effect.Effect<A, typeof BoundaryError.Type>,
): Promise<CoreOutcome<I>> => {
  const encode = Schema.encodeSync(schema);

  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* clientOverBinding(AppRpcs, {
        binding: appEnv().CORE,
        surface: "core",
        timeout: timeouts.appToCore,
      });

      return yield* use(client);
    }).pipe(
      Effect.scoped,
      Effect.map((value): CoreOutcome<I> => ({ ok: true, value: encode(value) })),
      Effect.catch((error) =>
        Effect.succeed<CoreOutcome<I>>({ ok: false, error: encodeError(error) }),
      ),
    ),
  );
};

/**
 * The browser sends each payload in its encoded form and this decodes it with
 * the same schema core checks it against, so a payload the contract rejects
 * never reaches the binding.
 *
 * Every function taking one of these is declared `POST`. A server function
 * defaults to `GET`, which puts its payload in the URL, and a CSV/OFX bundle
 * does not fit in one.
 */
const input = <A, I>(schema: Schema.Codec<A, I>) => {
  const decode = Schema.decodeUnknownSync(schema);

  return (value: I): A => decode(value);
};

export const listBankAccounts = createServerFn().handler(() =>
  callCore(Schema.Array(BankAccount), (client) => intoTaxonomy(client.listBankAccounts())),
);

export const registerBankAccount = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ account: RegisterBankAccount, requestId: RequestId })))
  .handler(({ data }) =>
    callCore(BankAccount, (client) => intoTaxonomy(client.registerBankAccount(data))),
  );

export const previewBankImport = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ source: BankImportSource })))
  .handler(({ data }) =>
    callCore(BankImportPreview, (client) => intoTaxonomy(client.previewBankImport(data))),
  );

export const confirmBankImport = createServerFn({ method: "POST" })
  .validator(
    input(
      Schema.Struct({
        source: BankImportSource,
        expectedBundleDigest: Sha256,
        expectedPreviewFingerprint: Sha256,
        resolutions: Schema.Array(AmbiguityResolution),
        requestId: RequestId,
      }),
    ),
  )
  .handler(({ data }) =>
    callCore(ConfirmedBankImport, (client) => intoTaxonomy(client.confirmBankImport(data))),
  );

export const archiveBankStatement = createServerFn({ method: "POST" })
  .validator(
    input(Schema.Struct({ accountId: BankAccountId, pdf: UploadedBytes, requestId: RequestId })),
  )
  .handler(({ data }) =>
    callCore(ArchivedBankStatement, (client) => intoTaxonomy(client.archiveBankStatement(data))),
  );

export const getImportHistory = createServerFn().handler(() =>
  callCore(Schema.Array(BankImportHistoryItem), (client) =>
    intoTaxonomy(client.getImportHistory({ accountId: null })),
  ),
);

export const getMoneyAnalysis = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ startMonth: CalendarMonth, endMonth: CalendarMonth })))
  .handler(({ data }) =>
    callCore(MoneyAnalysis, (client) => intoTaxonomy(client.getMoneyAnalysis(data))),
  );

export const getAccountBalances = createServerFn().handler(() =>
  callCore(Schema.Array(AccountBalance), (client) => intoTaxonomy(client.getAccountBalances())),
);

export const listCategories = createServerFn().handler(() =>
  callCore(Schema.Array(Category), (client) => intoTaxonomy(client.listCategories())),
);

export const listMonthlySpendingReports = createServerFn().handler(() =>
  callCore(Schema.Array(MonthlySpendingReport), (client) =>
    intoTaxonomy(client.listMonthlySpendingReports()),
  ),
);

export const getMonthlySpendingReport = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ id: ReportId })))
  .handler(({ data }) =>
    callCore(Schema.Struct({ report: MonthlySpendingReport, html: Schema.String }), (client) =>
      intoTaxonomy(client.getMonthlySpendingReport(data)),
    ),
  );

export const generateMonthlySpendingReport = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ month: CalendarMonth, requestId: RequestId })))
  .handler(({ data }) =>
    callCore(MonthlySpendingReport, (client) =>
      intoTaxonomy(client.generateMonthlySpendingReport(data)),
    ),
  );

export const markMonthlySpendingReportRead = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ id: ReportId, requestId: RequestId })))
  .handler(({ data }) =>
    callCore(MonthlySpendingReport, (client) =>
      intoTaxonomy(client.markMonthlySpendingReportRead(data)),
    ),
  );

export const getCategorizationReview = createServerFn().handler(() =>
  callCore(Schema.Array(CategorizationReviewItem), (client) =>
    intoTaxonomy(client.getCategorizationReview()),
  ),
);

export const categorizeTransactions = createServerFn({ method: "POST" })
  .validator(input(CategorizeTransactions))
  .handler(({ data }) =>
    callCore(Schema.Struct({ requestId: RequestId }), (client) =>
      intoTaxonomy(client.categorizeTransactions(data)),
    ),
  );
