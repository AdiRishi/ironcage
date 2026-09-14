import type { Candidate, Issue } from "@repo/contracts/finance";
import { Effect } from "effect";

export const issue = (code: (typeof Issue.Type)["code"], literal: string) => () => ({
  code,
  literal,
});
export const decodeCandidate = (decode: Effect.Effect<Candidate, typeof Issue.Type>) =>
  decode.pipe(
    Effect.match({
      onSuccess: (candidate) => ({ candidate, issue: null }),
      onFailure: (issue) => ({ candidate: null, issue }),
    }),
  );
