import {
  AmbiguityResolution,
  BoundaryError,
  RuleInput,
  SplitInput,
  TransferCandidateGroup,
  TransferMatchSummary,
} from "@ironcage/contracts/schema";
import {
  BankAccountId,
  BankTransactionId,
  CategorizationRuleId,
  CategoryId,
  CategoryKind,
  RequestId,
  Sha256,
  uuidV7From,
} from "@ironcage/domain";
import { Schema } from "effect";

/**
 * The payload schemas for Money's server functions. The browser sends the
 * encoded side of each schema, the server function decodes it at the boundary,
 * and the RPC client's payload types keep these aligned with the contract:
 * a drifted field fails `tsc` at the call site in `server/money.ts`.
 */

/**
 * One uploaded file crossing the server-function boundary. The browser reads
 * the bytes, base64 carries them through JSON, and the server function
 * rebuilds the `Uint8Array` the import contract expects.
 */
export const UploadPayload = Schema.Struct({
  displayName: Schema.String,
  base64: Schema.String,
});
export type UploadPayload = typeof UploadPayload.Type;

export const ImportSourcePayload = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("commbank_structured"),
    accountId: BankAccountId,
    csv: UploadPayload,
    ofx: UploadPayload,
  }),
  Schema.Struct({
    kind: Schema.Literal("commbank_statement"),
    accountId: BankAccountId,
    pdf: UploadPayload,
  }),
]);
export type ImportSourcePayload = typeof ImportSourcePayload.Type;

export const PreviewPayload = Schema.Struct({ source: ImportSourcePayload });

export const ConfirmPayload = Schema.Struct({
  source: ImportSourcePayload,
  expectedBundleDigest: Sha256,
  expectedPreviewFingerprint: Sha256,
  resolutions: Schema.Array(AmbiguityResolution),
  requestId: RequestId,
});

export const CategorizePayload = Schema.Struct({
  requestId: RequestId,
  changes: Schema.Array(
    Schema.Struct({
      transactionId: BankTransactionId,
      splits: Schema.Array(SplitInput),
    }),
  ),
  createRules: Schema.Array(RuleInput),
});

export const DecideTransferPayload = Schema.Struct({
  requestId: RequestId,
  transactionA: BankTransactionId,
  transactionB: BankTransactionId,
  decision: Schema.Literals(["confirm", "dismiss"]),
});

export const CreateCategoryPayload = Schema.Struct({
  requestId: RequestId,
  name: Schema.String,
  kind: CategoryKind,
});

export const EditCategoryPayload = Schema.Struct({
  requestId: RequestId,
  categoryId: CategoryId,
  name: Schema.NullOr(Schema.String),
  archived: Schema.NullOr(Schema.Boolean),
});

export const EditRulePayload = Schema.Struct({
  requestId: RequestId,
  action: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("create"), rule: RuleInput }),
    Schema.Struct({ kind: Schema.Literal("close"), ruleId: CategorizationRuleId }),
    Schema.Struct({
      kind: Schema.Literal("replace"),
      ruleId: CategorizationRuleId,
      rule: RuleInput,
    }),
  ]),
});

/** `getTransferMatches` returns an anonymous struct; named once, used by both sides. */
export const TransferMatches = Schema.Struct({
  matches: Schema.Array(TransferMatchSummary),
  unresolved: Schema.Array(TransferCandidateGroup),
});

/**
 * What a mutation server function returns: the RPC's success or its typed
 * boundary error, both as data. Errors cross as values rather than thrown
 * strings so a route can branch on the tag — a `Stale` confirm re-previews,
 * everything else renders.
 */
export const Outcome = <S extends Schema.Codec<unknown, unknown>>(success: S) =>
  Schema.Union([
    Schema.Struct({ outcome: Schema.Literal("ok"), value: success }),
    Schema.Struct({ outcome: Schema.Literal("error"), error: BoundaryError }),
  ]);

/**
 * Minted in the browser at the moment of intent, so a retry of the same
 * intent replays as itself instead of acting twice.
 */
export const mintRequestId = (): RequestId =>
  Schema.decodeUnknownSync(RequestId)(
    uuidV7From(Date.now(), crypto.getRandomValues(new Uint8Array(16))),
  );
