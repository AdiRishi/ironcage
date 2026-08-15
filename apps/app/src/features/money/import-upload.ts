import {
  BankImportSource,
  ConfirmBankImportMetadata,
  ConfirmBankImportPayload,
  type UploadedBytes,
} from "@ironcage/contracts/schema";
import { BankAccountId } from "@ironcage/domain";
import { Schema } from "effect";

const maximumFileBytes = 25 * 1024 * 1024;
const UploadedFile = Schema.instanceOf(File);

const ImportSourceDraft = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("commbank_structured"),
    accountId: BankAccountId,
    csv: UploadedFile,
    ofx: UploadedFile,
  }),
  Schema.Struct({
    kind: Schema.Literal("commbank_statement"),
    accountId: BankAccountId,
    pdf: UploadedFile,
  }),
]);
export type ImportSourceDraft = typeof ImportSourceDraft.Type;

export interface ConfirmImportDraft extends ConfirmBankImportMetadata {
  readonly source: ImportSourceDraft;
}

const decodeDraft = Schema.decodeUnknownSync(ImportSourceDraft);
const decodeMetadata = Schema.decodeUnknownSync(Schema.fromJsonString(ConfirmBankImportMetadata));
const decodePayload = Schema.decodeUnknownSync(ConfirmBankImportPayload);
const encodeMetadata = Schema.encodeSync(Schema.fromJsonString(ConfirmBankImportMetadata));

const appendSource = (form: FormData, source: ImportSourceDraft) => {
  form.set("kind", source.kind);
  form.set("accountId", source.accountId);
  if (source.kind === "commbank_structured") {
    form.set("csv", source.csv);
    form.set("ofx", source.ofx);
  } else {
    form.set("pdf", source.pdf);
  }
};

export const previewUpload = (source: ImportSourceDraft): FormData => {
  const form = new FormData();
  appendSource(form, source);
  return form;
};

export const confirmUpload = ({ source, ...metadata }: ConfirmImportDraft): FormData => {
  const form = previewUpload(source);
  form.set("metadata", encodeMetadata(metadata));
  return form;
};

const draftFrom = (form: FormData): ImportSourceDraft =>
  decodeDraft(Object.fromEntries(form.entries()));

const uploadedBytes = async (file: File): Promise<UploadedBytes> => {
  if (file.size > maximumFileBytes) {
    throw new Error(`${file.name} exceeds the 25 MiB import limit`);
  }
  return { displayName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
};

const sourceFrom = async (form: FormData): Promise<BankImportSource> => {
  const draft = draftFrom(form);
  return draft.kind === "commbank_structured"
    ? {
        kind: draft.kind,
        accountId: draft.accountId,
        csv: await uploadedBytes(draft.csv),
        ofx: await uploadedBytes(draft.ofx),
      }
    : {
        kind: draft.kind,
        accountId: draft.accountId,
        pdf: await uploadedBytes(draft.pdf),
      };
};

export const decodePreviewUpload = sourceFrom;

export const decodeConfirmUpload = async (form: FormData): Promise<ConfirmBankImportPayload> => {
  const metadata = decodeMetadata(form.get("metadata"));
  return decodePayload({ source: await sourceFrom(form), ...metadata });
};
