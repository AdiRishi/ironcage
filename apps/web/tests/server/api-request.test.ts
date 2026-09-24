import { FinanceError } from "@repo/contracts/finance";
import { isCancelledError } from "@tanstack/react-query";
import { makeRpcStub, encodeRpcError, ErrorTag } from "alchemy/Cloudflare/Bridge";
import { Effect } from "effect";
import { expect, test } from "vitest";

import { AppRequestError } from "@/lib/app-error";
import { createQueryClient } from "@/lib/query-client";
import { runApiRequest } from "@/server/api-request";

const signal = () => new AbortController().signal;

test("native RPC transport failures do not disclose internal diagnostics", async () => {
  const client = makeRpcStub<{ read: () => Effect.Effect<string> }>({
    read: async () => {
      throw new Error("private.service.internal: sensitive credentials");
    },
  });
  await expect(runApiRequest(client.read(), signal())).rejects.toEqual(
    new AppRequestError("unavailable", "The service is temporarily unavailable. Please try again."),
  );
});

test("unexpected defects become safe internal errors", async () => {
  await expect(runApiRequest(Effect.die(new Error("private query")), signal())).rejects.toEqual(
    new AppRequestError("internal", "The request could not be completed."),
  );
});

test("cancelling a query interrupts its request scope without producing an application error", async () => {
  const started = Promise.withResolvers<void>();
  const stopped = Promise.withResolvers<void>();
  const client = createQueryClient();
  try {
    const result = client
      .fetchQuery({
        queryKey: ["cancel"],
        queryFn: ({ signal }) =>
          runApiRequest(
            Effect.sync(() => started.resolve()).pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(Effect.sync(() => stopped.resolve())),
            ),
            signal,
          ),
      })
      .catch((error: Error) => error);
    await started.promise;
    await client.cancelQueries({ queryKey: ["cancel"] });
    expect(isCancelledError(await result)).toBe(true);
    await stopped.promise;
  } finally {
    client.clear();
  }
});

test("an expired RPC deadline becomes a retryable unavailable error", async () => {
  await expect(
    runApiRequest(Effect.never.pipe(Effect.timeout("20 millis")), signal()),
  ).rejects.toEqual(
    new AppRequestError("unavailable", "The service is temporarily unavailable. Please try again."),
  );
});

test("financial conflicts retain their message across the native RPC error envelope", async () => {
  const client = makeRpcStub<{ write: () => Effect.Effect<never, FinanceError> }>(
    {
      write: async () => ({
        _tag: ErrorTag,
        error: encodeRpcError(
          new FinanceError({
            kind: "conflict",
            message: "Allocations must sum to the booked magnitude.",
          }),
        ),
      }),
    },
    { errors: [FinanceError] },
  );
  await expect(runApiRequest(client.write(), signal())).rejects.toEqual(
    new AppRequestError("conflict", "Allocations must sum to the booked magnitude."),
  );
});
