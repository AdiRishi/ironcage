import { FinanceError } from "@repo/contracts/finance";
import type { ApiClient, WebOperation } from "@repo/infra/api";
import { getRequest } from "@tanstack/react-start/server";
import { makeRpcStub } from "alchemy/Cloudflare/Bridge";
import { env } from "cloudflare:workers";
import { Effect } from "effect";

import { runRpcRequest } from "./rpc-request";

const apiOrigin = "https://api.internal";

export const fetchApi = (path: string, init?: RequestInit) =>
  env.API.fetch(new Request(new URL(path, apiOrigin), init));

export const callApiRpc = <A, E>(
  use: (client: ApiClient<WebOperation>) => Effect.Effect<A, E>,
): Promise<A> =>
  runRpcRequest(
    Effect.suspend(() =>
      use(makeRpcStub<ApiClient<WebOperation>>(env.API, { errors: [FinanceError] })),
    ).pipe(Effect.timeout("10 seconds")),
    getRequest().signal,
  );
