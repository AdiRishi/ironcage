import type { Proposal, ProposalInput, ResolveProposal } from "@repo/contracts/analyst";
import { FinanceError } from "@repo/contracts/finance";
import type { AnalystOperation, Api } from "@repo/infra/api";
import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql";

import { toFinanceError } from "../storage/failures.ts";
import { readProposal, refreshProposal, resolveProposal } from "../storage/proposals.ts";
import { proposalFor } from "../tools/proposals.ts";

const alreadyAccepted = new FinanceError({
  kind: "conflict",
  message: "You already accepted this change.",
});

export class Proposals extends Context.Service<
  Proposals,
  {
    // Records that you accepted or ignored a proposal, or that Accept found it stale.
    // Repeating an outcome changes nothing, and an accepted proposal stays accepted.
    readonly resolve: (input: ResolveProposal) => Effect.Effect<Proposal, FinanceError>;
    // Previews the proposal again against the records as they are now, and sets it
    // pending.
    readonly refresh: (input: typeof ProposalInput.Type) => Effect.Effect<Proposal, FinanceError>;
  }
>()("@repo/analyst/proposals/Proposals") {
  static readonly layer = (api: Pick<Api, AnalystOperation>) =>
    Layer.effect(
      Proposals,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const provide = Effect.provideService(SqlClient.SqlClient, sql);
        const previewIntent = proposalFor(api);

        const resolve = Effect.fn("Proposals.resolve")(
          function* (input: ResolveProposal) {
            const { outcome } = input;
            const current = yield* readProposal(input.proposalId);
            if (current.status === "accepted")
              return outcome.kind === "accepted" && outcome.commandId === current.commandId
                ? current
                : yield* alreadyAccepted;
            if (current.status === outcome.kind) return current;
            yield* resolveProposal(input);
            return yield* readProposal(input.proposalId);
          },
          provide,
          toFinanceError,
        );

        const refresh = Effect.fn("Proposals.refresh")(
          function* ({ proposalId }: typeof ProposalInput.Type) {
            const current = yield* readProposal(proposalId);
            if (current.status === "accepted") return yield* alreadyAccepted;
            const { preview, title } = yield* previewIntent(current.intent);
            // The preview reads the API, and the proposal can be accepted meanwhile.
            if (!(yield* refreshProposal(proposalId, { preview, title })))
              return yield* alreadyAccepted;
            return yield* readProposal(proposalId);
          },
          provide,
          toFinanceError,
        );

        return Proposals.of({ resolve, refresh });
      }),
    );
}
