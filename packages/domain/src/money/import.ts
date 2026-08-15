import { Schema } from "effect";

/**
 * Every import is interpreted by one named and versioned source profile; the
 * name embeds the version, and a grammar change ships as a new name.
 */
export const SourceProfile = Schema.Literal("cba-netbank-paired-v1");
export type SourceProfile = typeof SourceProfile.Type;

export const SourceFileRole = Schema.Literals(["csv", "ofx"]);
export type SourceFileRole = typeof SourceFileRole.Type;

/**
 * How an observation was linked to its canonical transaction — the dedupe
 * tier that proved the link, or `new` when every stronger tier found nothing.
 */
export const MatchTier = Schema.Literals(["bundle", "identifier", "row_balance", "content", "new"]);
export type MatchTier = typeof MatchTier.Type;

/** What preview reports for each incoming candidate. */
export const CandidateStatus = Schema.Literals(["new", "duplicate", "ambiguous"]);
export type CandidateStatus = typeof CandidateStatus.Type;
