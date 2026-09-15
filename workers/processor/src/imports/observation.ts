import type { Candidate, Issue, Locator, ParsedObservation } from "@repo/contracts/finance";
import { Effect } from "effect";

export const locatorKey = (locator: typeof Locator.Type) =>
  locator.kind === "csvLine"
    ? `csvLine:${locator.line}`
    : locator.kind === "ofxTransaction"
      ? `ofxTransaction:${locator.statement}:${locator.ordinal}`
      : `pdfRow:${locator.page}:${locator.row}`;

export const issue = (code: (typeof Issue.Type)["code"], literal: string) => () => ({
  code,
  literal,
});

// A row whose required value cannot be read keeps its issue and gets no candidate.
export const observation = (
  locator: typeof Locator.Type,
  raw: Record<string, string>,
  decode: Effect.Effect<Candidate, typeof Issue.Type>,
): Effect.Effect<ParsedObservation> =>
  decode.pipe(
    Effect.match({
      onSuccess: (candidate) => ({
        locatorKey: locatorKey(locator),
        locator,
        raw,
        candidate,
        issue: null,
      }),
      onFailure: (issue) => ({
        locatorKey: locatorKey(locator),
        locator,
        raw,
        candidate: null,
        issue,
      }),
    }),
  );
