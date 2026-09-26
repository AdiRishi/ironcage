import {
  Proposal,
  type ProposalId,
  ProposalIntent,
  ProposalPreview,
  type ResolveProposal,
  type TurnId,
} from "@repo/contracts/analyst";
import { FinanceError } from "@repo/contracts/finance";
import { DateTime, Effect, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";

const IntentText = Schema.fromJsonString(Schema.toCodecJson(ProposalIntent));
const PreviewText = Schema.fromJsonString(Schema.toCodecJson(ProposalPreview));
const ProposalText = Schema.fromJsonString(Schema.toCodecJson(Proposal));

// The proposal row `p` as the JSON encoding of `Proposal`.
export const proposalJson = (sql: SqlClient.SqlClient) =>
  sql`json_object('id', p.id, 'intent', json(p.intent), 'preview', json(p.preview),
    'title', p.title, 'reason', p.reason, 'status', p.status, 'commandId', p.command_id,
    'resolvedAt', p.resolved_at)`;

export const insertProposals = Effect.fn("insertProposals")(function* (
  turnId: TurnId,
  proposals: ReadonlyArray<Proposal>,
) {
  const sql = yield* SqlClient.SqlClient;
  for (const [index, proposal] of proposals.entries()) {
    const intent = yield* Schema.encodeEffect(IntentText)(proposal.intent);
    const preview = yield* Schema.encodeEffect(PreviewText)(proposal.preview);
    yield* sql`INSERT INTO proposals (id, turn_id, position, intent, preview, title, reason, status)
      VALUES (${proposal.id}, ${turnId}, ${index + 1}, ${intent}, ${preview}, ${proposal.title},
        ${proposal.reason}, 'pending')`;
  }
});

export const readProposal = Effect.fn("readProposal")(function* (id: ProposalId) {
  const sql = yield* SqlClient.SqlClient;
  const [proposal] =
    yield* sql`SELECT ${proposalJson(sql)} AS proposal FROM proposals p WHERE p.id = ${id}`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ proposal: ProposalText }))),
      ),
    );
  if (!proposal)
    return yield* new FinanceError({ kind: "notFound", message: "This proposal does not exist." });
  return proposal.proposal;
});

export const resolveProposal = Effect.fn("resolveProposal")(function* ({
  proposalId,
  outcome,
}: ResolveProposal) {
  const sql = yield* SqlClient.SqlClient;
  const at = DateTime.formatIso(yield* DateTime.now);
  yield* sql`UPDATE proposals SET status = ${outcome.kind},
      command_id = ${outcome.kind === "accepted" ? outcome.commandId : null},
      resolved_at = ${outcome.kind === "stale" ? null : at}
    WHERE id = ${proposalId}`;
});

// Replaces a proposal's preview and title with ones read against the records as they are
// now, and sets it pending again, unless you accepted it. The result says whether it did.
export const refreshProposal = Effect.fn("refreshProposal")(function* (
  id: ProposalId,
  refreshed: Pick<Proposal, "preview" | "title">,
) {
  const sql = yield* SqlClient.SqlClient;
  const preview = yield* Schema.encodeEffect(PreviewText)(refreshed.preview);
  const rows = yield* sql`UPDATE proposals SET preview = ${preview}, title = ${refreshed.title},
      status = 'pending', command_id = NULL, resolved_at = NULL
    WHERE id = ${id} AND status <> 'accepted' RETURNING id`;
  return rows.length > 0;
});
