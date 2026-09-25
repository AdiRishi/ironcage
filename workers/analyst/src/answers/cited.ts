import { type Answer, answerSegments, type Limit } from "@repo/contracts/analyst";
import { Array as Arr } from "effect";

import { basisOf, missingRecords } from "../evidence/basis.ts";
import type { Evidence } from "../evidence/service.ts";

// The figure a limit qualifies, if it qualifies one.
const figureOf = (limit: Limit) =>
  limit.kind === "notUnderstood" || limit.kind === "modelShare" ? [limit.figureId] : [];

// An accepted answer as its turn keeps it: the figures and records it cites, and the
// basis and limits of what it shows. A model's share qualifies only the figure it is part
// of, so it stays only beside a cited figure. Every other limit stays, with the figure it
// names. The basis covers the periods that place the figures shown and every check of a
// period's records, and states the days those periods lack.
export function citedAnswer(
  accepted: Pick<Answer, "text" | "missing">,
  evidence: Evidence,
): Answer {
  const cited = new Set(
    [accepted.text, ...accepted.missing].flatMap((text) =>
      answerSegments(text).flatMap((segment) => (segment.kind === "text" ? [] : [segment.id])),
    ),
  );
  const limits = evidence.limits.filter(
    (limit) => limit.kind !== "modelShare" || cited.has(limit.figureId),
  );
  const shown = new Set([...cited, ...limits.flatMap(figureOf)]);
  const figures = evidence.figures.filter((figure) => shown.has(figure.id));
  const reads = new Set([
    ...figures.flatMap((figure) => evidence.placed.get(figure.id) ?? []),
    ...evidence.checks,
  ]);
  const basis = basisOf(evidence.currency, [...reads], evidence.accounts);
  return {
    text: accepted.text,
    missing: accepted.missing,
    figures,
    records: evidence.records.filter((record) => cited.has(record.id)),
    basis,
    limits: Arr.dedupe([...(basis ? missingRecords(basis) : []), ...limits]),
  };
}
