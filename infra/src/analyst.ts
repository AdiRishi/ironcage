import { FinanceError } from "@repo/contracts/finance";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

import {
  conversations,
  type ConversationOperations,
} from "../../workers/analyst/src/conversations/index.ts";
import { analyst, type AnalystOperations } from "../../workers/analyst/src/index.ts";
import { workerCompatibility, workerObservability } from "./cloudflare-config.ts";
import { conversationBindings } from "./worker-bindings.ts";

export const AnalystGateway = Cloudflare.AI.Gateway("AnalystGateway", {
  authentication: true,
  collectLogs: false,
  cacheTtl: null,
});

// One instance, named "ledger", holds every conversation about the ledger.
export class Conversations extends Cloudflare.DurableObject<
  Conversations,
  ConversationOperations
>()("Conversations", { errors: [FinanceError] }) {}

const ConversationsLive = Conversations.make(
  // Suspended because worker-bindings.ts imports this module and is not loaded yet while
  // this one loads.
  Effect.suspend(() => conversationBindings()).pipe(
    Effect.map(conversations),
    Effect.provide(Cloudflare.AI.QueryGatewayBinding),
  ),
);

export class Analyst extends Cloudflare.Worker<Analyst, AnalystOperations>()("AnalystWorker") {}

export default Analyst.make(
  {
    main: import.meta.url,
    compatibility: workerCompatibility,
    workersDev: false,
    observability: workerObservability,
  },
  Effect.gen(function* () {
    return analyst(yield* Conversations);
  }).pipe(Effect.provide(ConversationsLive)),
);
