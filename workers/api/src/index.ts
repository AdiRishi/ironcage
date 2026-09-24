import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import type { Retention } from "@repo/contracts/finance";
import type { apiBindings } from "@repo/infra/worker-bindings";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { AccountHistory } from "./accounts/periods.ts";
import { AccountResolution } from "./accounts/resolution.ts";
import { Accounts } from "./accounts/service.ts";
import { Flows } from "./analysis/flows.ts";
import { SavedAnalyses } from "./analysis/saved.ts";
import { Analysis } from "./analysis/service.ts";
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

// Declared explicitly because deriving it from `api` would make the infra Worker
// class refer to itself through the bindings type.
export type ApiOperations = {
  saveAnalysis: SavedAnalyses["Service"]["save"];
  getAnalysis: SavedAnalyses["Service"]["get"];
  listAnalyses: () => SavedAnalyses["Service"]["list"];
  renameAnalysis: SavedAnalyses["Service"]["rename"];
  deleteAnalysis: SavedAnalyses["Service"]["remove"];
  overview: Analysis["Service"]["overview"];
  getPeriodFlow: Flows["Service"]["period"];
  getMonthlyFlow: Flows["Service"]["monthly"];
  getSpending: Flows["Service"]["spending"];
  compare: Analysis["Service"]["compare"];
  rows: Analysis["Service"]["rows"];
  contributors: Analysis["Service"]["contributors"];
  getEventRelationships: Relationships["Service"]["get"];
  listRelationshipCandidates: Relationships["Service"]["candidates"];
  previewRelationship: Relationships["Service"]["preview"];
  applyRelationship: Relationships["Service"]["apply"];
  listInterpretationReviews: InterpretationReviews["Service"]["list"];
  proposeRelationships: InterpretationReviews["Service"]["propose"];
  dismissInterpretationReview: InterpretationReviews["Service"]["dismiss"];
  listAccountPeriods: () => AccountHistory["Service"]["list"];
  saveAccountPeriod: AccountHistory["Service"]["save"];
  deleteAccountPeriod: AccountHistory["Service"]["remove"];
  listRules: () => Rules["Service"]["list"];
  getRuleExceptions: Rules["Service"]["exceptions"];
  previewRule: Rules["Service"]["preview"];
  saveRule: Rules["Service"]["save"];
  deleteRule: Rules["Service"]["remove"];
  saveReference: References["Service"]["save"];
  deleteReference: References["Service"]["remove"];
  previewCorrection: Corrections["Service"]["preview"];
  applyCorrection: Corrections["Service"]["apply"];
  undoCorrection: Corrections["Service"]["undo"];
  getCorrectionHistory: Corrections["Service"]["history"];
  reinterpretPostings: Events["Service"]["interpret"];
  listCounterparties: Counterparties["Service"]["list"];
  getCounterparty: Counterparties["Service"]["get"];
  saveCounterparty: Counterparties["Service"]["save"];
  mergeCounterparties: Counterparties["Service"]["merge"];
  moveAlias: Counterparties["Service"]["moveAlias"];
  assignEventCounterparty: Counterparties["Service"]["assignEvent"];
  listQuestions: Questions["Service"]["list"];
  getEnrichmentSettings: () => Enrichment["Service"]["settings"];
  updateEnrichmentSettings: Enrichment["Service"]["configure"];
  requestEnrichment: Enrichment["Service"]["request"];
  listEnrichmentRuns: () => Enrichment["Service"]["runs"];
  nextEnrichmentBatch: Enrichment["Service"]["batch"];
  completeEnrichmentBatch: Enrichment["Service"]["complete"];
  failEnrichment: Enrichment["Service"]["fail"];
  listCategoryProposals: () => Enrichment["Service"]["proposals"];
  getEvent: Events["Service"]["get"];
  getEventForPosting: Events["Service"]["forPosting"];
  getInterpretationSummary: () => Events["Service"]["summary"];
  getReferenceData: () => Events["Service"]["references"];
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
  listLedger: Postings["Service"]["ledger"];
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
    Analysis.layer,
    Flows.layer,
    SavedAnalyses.layer,
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
      ImportJobs.layer({
        start: bindings.processor.startImport,
        status: bindings.processor.getImportInstance,
      }),
    ]),
  );
  return yield* Effect.gen(function* () {
    const savedAnalyses = yield* SavedAnalyses;
    const analysis = yield* Analysis;
    const flows = yield* Flows;
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
    const uploads = yield* Uploads;
    const fetch = yield* HttpRouter.toHttpEffect(
      Layer.mergeAll(importHttpRoutes, exportHttpRoutes),
    );
    const operations = {
      saveAnalysis: savedAnalyses.save,
      getAnalysis: savedAnalyses.get,
      listAnalyses: () => savedAnalyses.list,
      renameAnalysis: savedAnalyses.rename,
      deleteAnalysis: savedAnalyses.remove,
      overview: analysis.overview,
      getPeriodFlow: flows.period,
      getMonthlyFlow: flows.monthly,
      getSpending: flows.spending,
      compare: analysis.compare,
      rows: analysis.rows,
      contributors: analysis.contributors,
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
      assignEventCounterparty: counterparties.assignEvent,
      listQuestions: questions.list,
      getEnrichmentSettings: () => enrichment.settings,
      updateEnrichmentSettings: enrichment.configure,
      requestEnrichment: enrichment.request,
      listEnrichmentRuns: () => enrichment.runs,
      nextEnrichmentBatch: enrichment.batch,
      completeEnrichmentBatch: enrichment.complete,
      failEnrichment: enrichment.fail,
      listCategoryProposals: () => enrichment.proposals,
      getEvent: events.get,
      getEventForPosting: events.forPosting,
      getInterpretationSummary: () => events.summary,
      getReferenceData: () => events.references,
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
      listLedger: postings.ledger,
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
