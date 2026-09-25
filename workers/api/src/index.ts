import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import type { apiBindings } from "@repo/infra/worker-bindings";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { AccountHistory } from "./accounts/periods.ts";
import { AccountResolution } from "./accounts/resolution.ts";
import { Accounts } from "./accounts/service.ts";
import { Flows } from "./analysis/flows.ts";
import { FactRebuilds } from "./analysis/rebuild.ts";
import { Spending } from "./analysis/spending.ts";
import { Commands } from "./database/commands.ts";
import { Corrections } from "./events/corrections.ts";
import { Events } from "./events/service.ts";
import { exportHttpRoutes } from "./exports/http.ts";
import { Exports } from "./exports/service.ts";
import { importHttpRoutes } from "./imports/http.ts";
import { Publication } from "./imports/publication.ts";
import { Imports } from "./imports/service.ts";
import { Uploads } from "./imports/uploads.ts";
import { Counterparties } from "./interpretation/counterparties.ts";
import { Enrichment } from "./interpretation/enrichment.ts";
import { Questions } from "./interpretation/questions.ts";
import { Models } from "./models/service.ts";
import {
  EnrichmentConfig,
  EnrichmentJobs,
  ExportJobs,
  FactJobs,
  RetentionPolicy,
  TemporaryExports,
  ImportJobs,
  Sources,
} from "./platform/services.ts";
import { Postings } from "./postings/service.ts";
import { References } from "./references/service.ts";
import { InterpretationReviews } from "./relationships/reviews.ts";
import { Relationships } from "./relationships/service.ts";
import { Reviews } from "./review/service.ts";
import { Rules } from "./rules/service.ts";
import { Settings } from "./settings/service.ts";
import { SourceFiles } from "./sources/service.ts";

// Every operation the API exposes, each a method of one service. The Worker's RPC types
// come from this object, so a changed service signature reaches every caller.
const operations = Effect.gen(function* () {
  const flows = yield* Flows;
  const spending = yield* Spending;
  const factRebuilds = yield* FactRebuilds;
  const relationships = yield* Relationships;
  const interpretationReviews = yield* InterpretationReviews;
  const accountHistory = yield* AccountHistory;
  const rules = yield* Rules;
  const references = yield* References;
  const corrections = yield* Corrections;
  const events = yield* Events;
  const sourceFiles = yield* SourceFiles;
  const counterparties = yield* Counterparties;
  const questions = yield* Questions;
  const enrichment = yield* Enrichment;
  const models = yield* Models;
  const exports = yield* Exports;
  const settings = yield* Settings;
  const reviews = yield* Reviews;
  const accounts = yield* Accounts;
  const postings = yield* Postings;
  const imports = yield* Imports;
  const publication = yield* Publication;
  const retention = yield* RetentionPolicy;
  return {
    getPeriodFlow: flows.period,
    getMonthlyFlow: flows.monthly,
    getSpending: spending.breakdown,
    getFactsStatus: () => factRebuilds.status,
    rebuildFactsBatch: () => factRebuilds.rebuild,
    getEventRelationships: relationships.get,
    listRelationshipCandidates: relationships.candidates,
    previewRelationship: relationships.preview,
    applyRelationship: relationships.apply,
    listInterpretationReviews: interpretationReviews.list,
    proposeRelationships: interpretationReviews.propose,
    dismissInterpretationReview: interpretationReviews.dismiss,
    listAccountPeriods: () => accountHistory.list,
    saveAccountPeriod: accountHistory.save,
    deleteAccountPeriod: accountHistory.remove,
    listRules: () => rules.list,
    getRuleExceptions: rules.exceptions,
    previewRule: rules.preview,
    saveRule: rules.save,
    deleteRule: rules.remove,
    saveReference: references.save,
    deleteReference: references.remove,
    previewCorrection: corrections.preview,
    applyCorrection: corrections.apply,
    undoCorrection: corrections.undo,
    getCorrectionHistory: corrections.history,
    reinterpretPostings: events.interpret,
    listCounterparties: counterparties.list,
    getCounterparty: counterparties.get,
    saveCounterparty: counterparties.save,
    mergeCounterparties: counterparties.merge,
    moveAlias: counterparties.moveAlias,
    saveReferenceDefault: counterparties.saveReference,
    deleteReferenceDefault: counterparties.deleteReference,
    assignEventCounterparty: counterparties.assignEvent,
    listQuestions: questions.list,
    getEnrichmentSettings: () => enrichment.settings,
    updateEnrichmentSettings: enrichment.configure,
    requestEnrichment: enrichment.request,
    requestEvaluation: enrichment.evaluate,
    listEnrichmentRuns: () => enrichment.runs,
    nextEnrichmentBatch: enrichment.batch,
    completeEnrichmentBatch: enrichment.complete,
    failEnrichment: enrichment.fail,
    listCategoryProposals: () => enrichment.proposals,
    resolveCategoryProposal: enrichment.resolveProposal,
    getEvent: events.get,
    getEventForPosting: events.forPosting,
    getReferenceData: () => events.references,
    listSourceFiles: () => sourceFiles.list,
    removeSourceBytes: sourceFiles.remove,
    getModelUsage: () => models.get,
    requestExport: exports.request,
    listExports: () => exports.list,
    getExport: exports.get,
    generateExport: exports.generate,
    failExport: exports.fail,
    getRetention: () => Effect.succeed(retention),
    getSettings: () => settings.get,
    updateSettings: settings.update,
    listReviewItems: reviews.list,
    resolveReview: reviews.resolve,
    listAccounts: () => accounts.list,
    createAccount: accounts.create,
    updateAccount: accounts.update,
    listPostings: postings.list,
    listLedger: postings.ledger,
    listCountedLedger: postings.counted,
    getPosting: postings.get,
    retryImport: imports.retry,
    listImports: imports.list,
    getImport: imports.get,
    getImportSource: imports.source,
    failImport: imports.fail,
    publishImport: publication.publish,
  };
});
export type ApiOperations = Effect.Success<typeof operations>;
// Operations only the processor and tests call. The web app may call the rest.
export type InternalOperation =
  | "nextEnrichmentBatch"
  | "completeEnrichmentBatch"
  | "failEnrichment"
  | "generateExport"
  | "failExport"
  | "getExport"
  | "listPostings"
  | "getImportSource"
  | "failImport"
  | "publishImport"
  | "rebuildFactsBatch";
export type WebOperation = Exclude<keyof ApiOperations, InternalOperation>;

export const api = Effect.fn("Api.initialize")(function* (
  bindings: Effect.Success<ReturnType<typeof apiBindings>>,
) {
  const services = Layer.mergeAll(
    Flows.layer,
    Spending.layer,
    FactRebuilds.layer,
    Accounts.layer,
    AccountHistory.layer,
    Events.layer,
    Corrections.layer,
    References.layer,
    Rules.layer,
    Relationships.layer,
    InterpretationReviews.layer,
    Exports.layer,
    SourceFiles.layer,
    Models.layer,
    Counterparties.layer,
    Questions.layer,
    Enrichment.layer,
    Reviews.layer,
    Postings.layer,
    Uploads.layer,
    Settings.layer,
  ).pipe(
    Layer.provideMerge(Layer.succeed(RetentionPolicy, bindings.retention)),
    Layer.provideMerge(Publication.layer),
    Layer.provideMerge(Imports.layer),
    Layer.provide([Commands.layer, AccountResolution.layer]),
    Layer.provide([
      bindings.database,
      Layer.succeed(EnrichmentConfig, { provider: bindings.enrichmentProvider }),
      EnrichmentJobs.layer({
        start: bindings.processor.startEnrichment,
        status: bindings.processor.getEnrichmentInstance,
      }),
      BrowserCrypto.layer,
      Sources.layer(bindings.sources),
      TemporaryExports.layer(bindings.exports),
      ExportJobs.layer({
        start: bindings.processor.startExport,
        status: bindings.processor.getExportInstance,
      }),
      FactJobs.layer({
        start: bindings.processor.startFactsRebuild,
        status: bindings.processor.getFactsRebuildInstance,
      }),
      ImportJobs.layer({
        start: bindings.processor.startImport,
        status: bindings.processor.getImportInstance,
      }),
    ]),
  );
  return yield* Effect.gen(function* () {
    const uploads = yield* Uploads;
    const exports = yield* Exports;
    const fetch = yield* HttpRouter.toHttpEffect(
      Layer.mergeAll(importHttpRoutes, exportHttpRoutes),
    );
    return {
      ...(yield* operations),
      fetch: fetch.pipe(
        Effect.provideService(Uploads, uploads),
        Effect.provideService(Exports, exports),
      ),
    };
  }).pipe(Effect.provide(services));
});
