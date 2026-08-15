import { ImportBlockCode, type ImportBlock } from "@ironcage/domain";
import { Effect, Schema } from "effect";

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
