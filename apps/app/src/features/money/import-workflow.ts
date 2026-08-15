import type { BankAccountSummary } from "@ironcage/contracts/schema";

import type { ImportSourceDraft } from "./import-upload";

export type ImportSelection =
  | {
      readonly mode: "structured";
      readonly accountId: BankAccountSummary["id"] | null;
      readonly csv: File | null;
      readonly ofx: File | null;
    }
  | {
      readonly mode: "statement";
      readonly accountId: BankAccountSummary["id"] | null;
      readonly pdf: File | null;
    };

export type ImportWorkflow =
  | { readonly stage: "select"; readonly selection: ImportSelection }
  | { readonly stage: "preview"; readonly source: ImportSourceDraft; readonly refreshed: boolean };

export type ImportWorkflowAction =
  | { readonly type: "selectAccount"; readonly accountId: BankAccountSummary["id"] }
  | { readonly type: "selectMode"; readonly mode: ImportSelection["mode"] }
  | { readonly type: "selectCsv"; readonly file: File }
  | { readonly type: "selectOfx"; readonly file: File }
  | { readonly type: "selectPdf"; readonly file: File }
  | { readonly type: "previewed"; readonly source: ImportSourceDraft }
  | { readonly type: "refreshing" }
  | { readonly type: "reset" };

export const initialImportWorkflow: ImportWorkflow = {
  stage: "select",
  selection: { mode: "structured", accountId: null, csv: null, ofx: null },
};

export const reduceImportWorkflow = (
  state: ImportWorkflow,
  action: ImportWorkflowAction,
): ImportWorkflow => {
  if (action.type === "reset") return initialImportWorkflow;
  if (action.type === "previewed") {
    return {
      stage: "preview",
      source: action.source,
      refreshed: state.stage === "preview" && state.refreshed,
    };
  }
  if (action.type === "refreshing") {
    return state.stage === "preview" ? { ...state, refreshed: true } : state;
  }
  if (state.stage !== "select") return state;

  switch (action.type) {
    case "selectAccount":
      return { ...state, selection: { ...state.selection, accountId: action.accountId } };
    case "selectMode":
      return {
        stage: "select",
        selection:
          action.mode === "structured"
            ? { mode: "structured", accountId: state.selection.accountId, csv: null, ofx: null }
            : { mode: "statement", accountId: state.selection.accountId, pdf: null },
      };
    case "selectCsv":
      return state.selection.mode === "structured"
        ? { ...state, selection: { ...state.selection, csv: action.file } }
        : state;
    case "selectOfx":
      return state.selection.mode === "structured"
        ? { ...state, selection: { ...state.selection, ofx: action.file } }
        : state;
    case "selectPdf":
      return state.selection.mode === "statement"
        ? { ...state, selection: { ...state.selection, pdf: action.file } }
        : state;
  }
};

export const selectedImportSource = (selection: ImportSelection): ImportSourceDraft | null => {
  if (selection.accountId === null) return null;
  if (selection.mode === "statement") {
    return selection.pdf === null
      ? null
      : { kind: "commbank_statement", accountId: selection.accountId, pdf: selection.pdf };
  }
  return selection.csv === null || selection.ofx === null
    ? null
    : {
        kind: "commbank_structured",
        accountId: selection.accountId,
        csv: selection.csv,
        ofx: selection.ofx,
      };
};
