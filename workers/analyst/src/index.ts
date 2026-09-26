import type {
  Ask,
  BriefingInput,
  ConversationInput,
  ListConversations,
  ProposalInput,
  ResolveProposal,
} from "@repo/contracts/analyst";
import type { Conversations } from "@repo/infra/analyst";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

// Every call goes to the one Conversations object, which holds the conversations about
// the ledger and its briefings.
export const analyst = Effect.fn("Analyst.initialize")(function* (
  namespace: Effect.Success<typeof Conversations>,
) {
  // Resolved on each call: while Alchemy plans the stack, the namespace does not exist.
  const ledger = () => namespace.getByName("ledger");
  // Hourly, so last month's briefing is queued within the hour its month ends in any
  // timezone, and again after a run found it could not be written yet. Alchemy drops a
  // failed run without a trace, so the run logs its own failure.
  yield* Cloudflare.Workers.cron("0 * * * *", () =>
    ledger()
      .queueLastMonthsBriefing()
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logError("The analyst could not queue last month's briefing", cause),
        ),
      ),
  );
  return {
    listConversations: (input: typeof ListConversations.Type) => ledger().listConversations(input),
    getConversation: (input: typeof ConversationInput.Type) => ledger().getConversation(input),
    ask: (input: Ask) => ledger().ask(input),
    resolveProposal: (input: ResolveProposal) => ledger().resolveProposal(input),
    refreshProposal: (input: typeof ProposalInput.Type) => ledger().refreshProposal(input),
    getBriefing: (input: BriefingInput) => ledger().getBriefing(input),
    requestBriefing: (input: BriefingInput) => ledger().requestBriefing(input),
    listBriefings: () => ledger().listBriefings(),
  };
});
export type AnalystOperations = Effect.Success<ReturnType<typeof analyst>>;
