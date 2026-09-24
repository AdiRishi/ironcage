import type { PreviewRule } from "@repo/contracts/finance";
import { Effect } from "effect";

import {
  loadReference,
  loadEventSubjects,
  matchesSubject,
  planDerivation,
  subjectRuleConflict,
} from "../interpretation/engine.ts";

// What saving the rule would change, derived with the rule's claims in place.
export const planRule = Effect.fn("planRule")(function* (input: typeof PreviewRule.Type) {
  const subjects = yield* loadEventSubjects("all");
  const reference = yield* loadReference;
  const excluded = new Set<string>(input.exceptionEventIds);
  const matches = subjects.filter((subject) => matchesSubject(input.rule, subject));
  const claiming =
    input.rule.scope === "future"
      ? new Set<string>()
      : new Set<string>(
          matches.filter((subject) => !excluded.has(subject.id)).map((subject) => subject.id),
        );
  const simulated =
    input.rule.scope === "future"
      ? []
      : subjects
          .filter(
            (subject) =>
              claiming.has(subject.id) || subject.rules.some((rule) => rule.id === input.rule.id),
          )
          .map((subject) => ({
            ...subject,
            rules: [
              ...subject.rules.filter((rule) => rule.id !== input.rule.id),
              ...(claiming.has(subject.id) ? [input.rule] : []),
            ],
          }));
  const changes = planDerivation(simulated, reference);
  const conflicts = simulated.filter(subjectRuleConflict).map((subject) => subject.id);
  const exceptions = matches.flatMap((subject) =>
    excluded.has(subject.id)
      ? [{ eventId: subject.id, reason: "Excluded from this rule" }]
      : subject.roleSource === "user" ||
          subject.roleSource === "link" ||
          subject.allocations.length > 1 ||
          subject.allocations.some((allocation) => allocation.categorySource === "user")
        ? [{ eventId: subject.id, reason: "Set by hand, split, or linked" }]
        : [],
  );
  return { matches, changes, conflicts, exceptions };
});
