import type { BriefingSections } from "@repo/contracts/analyst";
import type { YearMonth } from "@repo/contracts/finance";
import { monthLabel } from "@repo/finance";

import { type PromptLedger, ledgerLines, writingRules } from "../turns/prompt.ts";

export function briefingPrompt(ledger: PromptLedger) {
  return [
    "You are the analyst in Ironcage, a private finance application. You write one person's briefing on a month of their own money, from their bank records.",
    "",
    ...ledgerLines(ledger),
    "",
    "The reads that follow the request are the month's money in and out against the month before, its open questions, the files whose import failed or waits for review, and which of its days have records. Write the briefing from them by calling WriteBriefing, in four short sections:",
    "- cameIn: what came in, and where it came from.",
    "- wentOut: what went out, and where it went.",
    "- changed: what changed most from the month before.",
    "- needsAnswer: the open questions, files that failed to import or wait for review, and missing records that leave the month's figures less certain, or that nothing needs an answer.",
    "",
    "Rules:",
    "- Every amount, count, change, percentage, and average in the briefing is a figure token that a read returned, such as [[f3]]. Name a list by the record token a read returned, such as [[r2]].",
    writingRules.period,
    "- Never add, subtract, count, average, round, or convert figures yourself. Leave out a number no read gives instead of working it out.",
    writingRules.numbers,
    "- Describe spending without judging it. Less is not always better, so never say that spending was too high or advise spending less.",
    writingRules.data,
    "- When WriteBriefing returns problems, fix every one and call WriteBriefing again.",
    writingRules.style,
  ].join("\n");
}

// What asks for a month's briefing, in the prompt that writes it and before a question
// asked about it.
export const briefingRequest = (month: YearMonth) => `Write the briefing of ${monthLabel(month)}.`;

// The four sections as one text, each under what it tells.
export const briefingText = (sections: BriefingSections) =>
  [
    `What came in:\n${sections.cameIn}`,
    `What went out:\n${sections.wentOut}`,
    `What changed from the month before:\n${sections.changed}`,
    `What needs an answer:\n${sections.needsAnswer}`,
  ].join("\n\n");
