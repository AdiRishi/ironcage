import { ImportBlockCode, type ImportBlock } from "@ironcage/domain";
import { Effect, Schema } from "effect";

/**
 * The import boundary's refusal. Carried as a typed failure inside the import
 * pipeline; the preview handler renders it into the response as data.
 */
export class BankImportBlocked extends Schema.TaggedError<BankImportBlocked>()(
  "BankImportBlocked",
  {
    code: ImportBlockCode,
    detail: Schema.String,
  },
) {
  get block(): ImportBlock {
    return { code: this.code, detail: this.detail };
  }
}

export const blocked = (code: ImportBlockCode, detail: string) =>
  Effect.fail(new BankImportBlocked({ code, detail }));
