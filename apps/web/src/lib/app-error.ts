import { type FinanceError } from "@repo/contracts/finance";
import { Schema } from "effect";

type AppErrorCode = FinanceError["kind"] | "internal";

export class AppRequestError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.name = "AppRequestError";
    this.code = code;
    delete this.stack;
  }
}

export const appRequestErrorSerialization = {
  key: "AppRequestError",
  test: Schema.is(Schema.instanceOf(AppRequestError)),
  toSerializable: (error: AppRequestError) => ({ code: error.code, message: error.message }),
  fromSerializable: ({ code, message }: Pick<AppRequestError, "code" | "message">) =>
    new AppRequestError(code, message),
};
