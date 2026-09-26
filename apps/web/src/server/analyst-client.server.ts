import { FinanceError } from "@repo/contracts/finance";
import type { AnalystClient } from "@repo/infra/analyst";
import { getRequest } from "@tanstack/react-start/server";
import { makeRpcStub } from "alchemy/Cloudflare/Bridge";
import { env } from "cloudflare:workers";
import { Effect } from "effect";

import { runRpcRequest } from "./rpc-request";

export const callAnalystRpc = <A, E>(
  use: (client: AnalystClient) => Effect.Effect<A, E>,
): Promise<A> =>
  runRpcRequest(
    Effect.suspend(() =>
      use(makeRpcStub<AnalystClient>(env.ANALYST, { errors: [FinanceError] })),
    ).pipe(Effect.timeout("10 seconds")),
    getRequest().signal,
  );
