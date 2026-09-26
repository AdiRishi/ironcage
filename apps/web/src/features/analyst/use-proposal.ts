import type {
  Conversation,
  ConversationId,
  Proposal,
  ProposalId,
  ProposalPreview,
} from "@repo/contracts/analyst";
import { ApplyCorrection, CommandId } from "@repo/contracts/finance";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Effect, Schema } from "effect";

import { applyCounterpartyChange } from "@/features/counterparties/functions";
import { applyCorrection } from "@/features/events/functions";
import { AppRequestError } from "@/lib/app-error";
import { useCommand } from "@/lib/use-command";

import { refreshProposal, resolveProposal } from "./functions";
import { conversationQuery } from "./queries";

// The ordinary command a proposal previewed, with the versions its preview read.
async function apply(preview: ProposalPreview, commandId: typeof CommandId.Type) {
  switch (preview.kind) {
    case "correction":
      await applyCorrection({
        data: await Effect.runPromise(
          Schema.encodeEffect(ApplyCorrection)({
            commandId,
            change: preview.change,
            expectedVersions: preview.expectedVersions,
          }),
        ),
      });
      return;
    case "counterpartyChange":
      await applyCounterpartyChange({ data: { commandId, change: preview.change } });
  }
}

const withProposal = (conversation: Conversation, proposal: Proposal): Conversation => ({
  ...conversation,
  turns: conversation.turns.map((turn) =>
    turn.status === "answered"
      ? {
          ...turn,
          answer: {
            ...turn.answer,
            proposals: turn.answer.proposals.map((item) =>
              item.id === proposal.id ? proposal : item,
            ),
          },
        }
      : turn,
  ),
});

// Accept, Ignore, and Preview again on a proposal in a conversation. Accept applies the
// change as previewed and then records that you accepted it, so Retry after a lost reply
// sends both again with the same command ID and the change applies once. When the records
// changed since the preview, Accept records the proposal stale instead. Each outcome goes
// straight into the conversation's cache.
export function useProposal(conversationId: ConversationId, proposal: Proposal) {
  const client = useQueryClient();
  const store = (next: Proposal) =>
    client.setQueryData(
      conversationQuery(conversationId).queryKey,
      (conversation) => conversation && withProposal(conversation, next),
    );
  const accepting = useCommand({
    mutationFn: async ({
      commandId,
      proposalId,
      preview,
    }: {
      commandId: typeof CommandId.Type;
      proposalId: ProposalId;
      preview: ProposalPreview;
    }) => {
      try {
        await apply(preview, commandId);
      } catch (error) {
        if (error instanceof AppRequestError && error.code === "stale")
          store(await resolveProposal({ data: { proposalId, outcome: { kind: "stale" } } }));
        throw error;
      }
      return resolveProposal({ data: { proposalId, outcome: { kind: "accepted", commandId } } });
    },
    onSuccess: async (accepted) => {
      store(accepted);
      await client.invalidateQueries();
    },
  });
  const ignoring = useMutation({
    mutationFn: () =>
      resolveProposal({ data: { proposalId: proposal.id, outcome: { kind: "ignored" } } }),
    onSuccess: store,
  });
  const refreshing = useMutation({
    mutationFn: () => refreshProposal({ data: { proposalId: proposal.id } }),
    onSuccess: (refreshed) => {
      accepting.mutation.reset();
      store(refreshed);
    },
  });
  const error = [accepting.mutation.error, ignoring.error, refreshing.error].find(
    (item) => item !== null && !(item instanceof AppRequestError && item.code === "stale"),
  );
  return {
    accept: () => {
      ignoring.reset();
      refreshing.reset();
      accepting.submit({
        commandId: CommandId.make(crypto.randomUUID()),
        proposalId: proposal.id,
        preview: proposal.preview,
      });
    },
    ignore: () => {
      accepting.mutation.reset();
      refreshing.reset();
      ignoring.mutate();
    },
    refresh: () => {
      ignoring.reset();
      refreshing.mutate();
    },
    accepting: accepting.mutation.isPending,
    ignoring: ignoring.isPending,
    refreshing: refreshing.isPending,
    uncertain: accepting.uncertain,
    // What went wrong, other than the records changing, which the proposal itself says.
    error: error ?? null,
  };
}
