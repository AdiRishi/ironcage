import { Schema } from "effect";

const AppErrorCode = Schema.Literals(["invalid_request", "not_found", "unavailable", "internal"]);

export class AppRequestError extends Error {
  readonly code: typeof AppErrorCode.Type;

  constructor(code: typeof AppErrorCode.Type, message: string) {
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
