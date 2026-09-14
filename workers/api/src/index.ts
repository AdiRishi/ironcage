import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import type { apiBindings } from "@repo/infra/worker-bindings";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { AccountResolution } from "./accounts/resolution.ts";
import { Accounts } from "./accounts/service.ts";
import { Commands } from "./database/commands.ts";
import { importHttpRoutes } from "./imports/http.ts";
import { Publication } from "./imports/publication.ts";
import { ImportRepository } from "./imports/repository.ts";
import { Uploads } from "./imports/uploads.ts";
import { ImportJobs, Sources } from "./platform/services.ts";
import { Postings } from "./postings/service.ts";
import { Reviews } from "./review/service.ts";

export type ApiOperations = {
  listReviewItems: Reviews["Service"]["list"];
  resolveReview: Reviews["Service"]["resolve"];
  listAccounts: Accounts["Service"]["list"];
  createAccount: Accounts["Service"]["create"];
  updateAccount: Accounts["Service"]["update"];
  listPostings: Postings["Service"]["list"];
  getPosting: Postings["Service"]["get"];
  listImports: ImportRepository["Service"]["list"];
  getImport: ImportRepository["Service"]["get"];
  getImportSource: ImportRepository["Service"]["source"];
  failImport: ImportRepository["Service"]["fail"];
  publishImport: Publication["Service"]["publish"];
};

export const api = Effect.fn("Api.initialize")(function* (
  bindings: Effect.Success<ReturnType<typeof apiBindings>>,
) {
  const services = Layer.mergeAll(Accounts.layer, Reviews.layer, Postings.layer, Uploads.layer)
    .pipe(Layer.provideMerge(Publication.layer))
    .pipe(Layer.provideMerge(ImportRepository.layer))
    .pipe(
      Layer.provide([Commands.layer, AccountResolution.layer]),
      Layer.provide([
        bindings.database,
        BrowserCrypto.layer,
        Layer.succeed(Sources, bindings.sources),
        Layer.succeed(ImportJobs, {
          start: bindings.processor.startImport,
          status: bindings.processor.getImportInstance,
        }),
      ]),
    );
  return yield* Effect.gen(function* () {
    const reviews = yield* Reviews;
    const accounts = yield* Accounts;
    const postings = yield* Postings;
    const imports = yield* ImportRepository;
    const publication = yield* Publication;
    const uploads = yield* Uploads;
    const fetch = yield* HttpRouter.toHttpEffect(importHttpRoutes);
    const operations = {
      listReviewItems: reviews.list,
      resolveReview: reviews.resolve,
      listAccounts: accounts.list,
      createAccount: accounts.create,
      updateAccount: accounts.update,
      listPostings: postings.list,
      getPosting: postings.get,
      listImports: imports.list,
      getImport: imports.get,
      getImportSource: imports.source,
      failImport: imports.fail,
      publishImport: publication.publish,
    } satisfies ApiOperations;
    return { ...operations, fetch: fetch.pipe(Effect.provideService(Uploads, uploads)) };
  }).pipe(Effect.provide(services));
});
