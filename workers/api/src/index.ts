import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import type { Retention } from "@repo/contracts/finance";
import type { apiBindings } from "@repo/infra/worker-bindings";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { AccountResolution } from "./accounts/resolution.ts";
import { Accounts } from "./accounts/service.ts";
import { Commands } from "./database/commands.ts";
import { exportHttpRoutes } from "./exports/http.ts";
import { Exports } from "./exports/service.ts";
import { importHttpRoutes } from "./imports/http.ts";
import { Publication } from "./imports/publication.ts";
import { Imports } from "./imports/service.ts";
import { Uploads } from "./imports/uploads.ts";
import { Models } from "./models/service.ts";
import { ExportJobs, TemporaryExports, ImportJobs, Sources } from "./platform/services.ts";
import { Postings } from "./postings/service.ts";
import { Reviews } from "./review/service.ts";
import { Settings } from "./settings/service.ts";
import { SourceFiles } from "./sources/service.ts";

// Declared explicitly because deriving it from `api` would make the infra Worker
// class refer to itself through the bindings type.
export type ApiOperations = {
  listSourceFiles: () => SourceFiles["Service"]["list"];
  removeSourceBytes: SourceFiles["Service"]["remove"];
  getModelUsage: () => Models["Service"]["get"];
  requestExport: Exports["Service"]["request"];
  listExports: () => Exports["Service"]["list"];
  getExport: Exports["Service"]["get"];
  generateExport: Exports["Service"]["generate"];
  failExport: Exports["Service"]["fail"];
  getRetention: () => Effect.Effect<typeof Retention.Type>;
  getSettings: () => Settings["Service"]["get"];
  updateSettings: Settings["Service"]["update"];
  listReviewItems: Reviews["Service"]["list"];
  resolveReview: Reviews["Service"]["resolve"];
  listAccounts: () => Accounts["Service"]["list"];
  createAccount: Accounts["Service"]["create"];
  updateAccount: Accounts["Service"]["update"];
  listPostings: Postings["Service"]["list"];
  getPosting: Postings["Service"]["get"];
  retryImport: Imports["Service"]["retry"];
  listImports: Imports["Service"]["list"];
  getImport: Imports["Service"]["get"];
  getImportSource: Imports["Service"]["source"];
  failImport: Imports["Service"]["fail"];
  publishImport: Publication["Service"]["publish"];
};

export const api = Effect.fn("Api.initialize")(function* (
  bindings: Effect.Success<ReturnType<typeof apiBindings>>,
) {
  const services = Layer.mergeAll(
    Accounts.layer,
    Exports.layer,
    SourceFiles.layer,
    Models.layer,
    Reviews.layer,
    Postings.layer,
    Uploads.layer,
    Settings.layer,
  ).pipe(
    Layer.provideMerge(Publication.layer),
    Layer.provideMerge(Imports.layer),
    Layer.provide([Commands.layer, AccountResolution.layer]),
    Layer.provide([
      bindings.database,
      BrowserCrypto.layer,
      Sources.layer(bindings.sources),
      TemporaryExports.layer(bindings.exports),
      ExportJobs.layer({
        start: bindings.processor.startExport,
        status: bindings.processor.getExportInstance,
      }),
      ImportJobs.layer({
        start: bindings.processor.startImport,
        status: bindings.processor.getImportInstance,
      }),
    ]),
  );
  return yield* Effect.gen(function* () {
    const sourceFiles = yield* SourceFiles;
    const models = yield* Models;
    const exports = yield* Exports;
    const settings = yield* Settings;
    const reviews = yield* Reviews;
    const accounts = yield* Accounts;
    const postings = yield* Postings;
    const imports = yield* Imports;
    const publication = yield* Publication;
    const uploads = yield* Uploads;
    const fetch = yield* HttpRouter.toHttpEffect(
      Layer.mergeAll(importHttpRoutes, exportHttpRoutes),
    );
    const operations = {
      listSourceFiles: () => sourceFiles.list,
      removeSourceBytes: sourceFiles.remove,
      getModelUsage: () => models.get,
      requestExport: exports.request,
      listExports: () => exports.list,
      getExport: exports.get,
      generateExport: exports.generate,
      failExport: exports.fail,
      getRetention: () => Effect.succeed(bindings.retention),
      getSettings: () => settings.get,
      updateSettings: settings.update,
      listReviewItems: reviews.list,
      resolveReview: reviews.resolve,
      listAccounts: () => accounts.list,
      createAccount: accounts.create,
      updateAccount: accounts.update,
      listPostings: postings.list,
      getPosting: postings.get,
      retryImport: imports.retry,
      listImports: imports.list,
      getImport: imports.get,
      getImportSource: imports.source,
      failImport: imports.fail,
      publishImport: publication.publish,
    } satisfies ApiOperations;
    return {
      ...operations,
      fetch: fetch.pipe(
        Effect.provideService(Uploads, uploads),
        Effect.provideService(Exports, exports),
      ),
    };
  }).pipe(Effect.provide(services));
});
