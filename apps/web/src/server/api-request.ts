import { FinanceError } from "@repo/contracts/finance";
import { RpcCallError } from "alchemy/Cloudflare/Bridge";
import { Cause, Effect, Schema } from "effect";

import { AppRequestError } from "@/lib/app-error";

export const runApiRequest = <A, E>(effect: Effect.Effect<A, E>, signal: AbortSignal): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
        const failure = Cause.squash(cause);
        if (Schema.is(Schema.Struct(FinanceError.fields))(failure))
          return Effect.fail(new AppRequestError(failure.kind, failure.message));
        const error =
          failure instanceof RpcCallError || Cause.isTimeoutError(failure)
            ? new AppRequestError(
                "unavailable",
                "The service is temporarily unavailable. Please try again.",
              )
            : new AppRequestError("internal", "The request could not be completed.");
        return Effect.logError("API request failed").pipe(Effect.andThen(Effect.fail(error)));
      }),
    ),
    { signal },
  );
