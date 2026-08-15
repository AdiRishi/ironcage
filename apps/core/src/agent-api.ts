import { AgentReadRpcs, rpcHttpRoute } from "@ironcage/contracts/server";
import { HttpRouter } from "effect/unstable/http";

import { ping, workerRequest } from "./runtime";

const agentSurface = HttpRouter.toWebHandler(
  rpcHttpRoute(AgentReadRpcs, AgentReadRpcs.toLayer({ ping: () => ping("AgentReadApi") })),
);

export const handleAgentRequest = (
  request: Request,
  env: Env,
  executionContext: ExecutionContext,
) => agentSurface.handler(request, workerRequest.forRequest(env, executionContext));
