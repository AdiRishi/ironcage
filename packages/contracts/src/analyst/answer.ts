import { Schema } from "effect";

import { Basis, Limit } from "./basis.ts";
import { Proposal } from "./proposals.ts";
import { Figure, FigureId, RecordId, RecordRef } from "./references.ts";

// An answer that passed its checks. `text`, each entry of `missing` that says what the
// records could not answer, and each proposal's reason follow the answer grammar and cite
// only `figures` and `records`. `basis` covers the periods of the figures the answer shows
// and of every check of a period's records, and is null when there are none.
export const Answer = Schema.Struct({
  text: Schema.String,
  missing: Schema.Array(Schema.String),
  figures: Schema.Array(Figure),
  records: Schema.Array(RecordRef),
  basis: Schema.NullOr(Basis),
  limits: Schema.Array(Limit),
  proposals: Schema.Array(Proposal),
});
export type Answer = typeof Answer.Type;

export type AnswerSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "figure"; readonly id: FigureId }
  | { readonly kind: "record"; readonly id: RecordId };
export type AnswerBlock =
  | { readonly kind: "paragraph"; readonly segments: ReadonlyArray<AnswerSegment> }
  | { readonly kind: "list"; readonly items: ReadonlyArray<ReadonlyArray<AnswerSegment>> };

const token = /\[\[([fr][1-9]\d*)\]\]/;
const bullet = "- ";

// Splitting on a pattern with one group puts each token's ID at the odd indexes.
function segmentsOf(text: string) {
  return text.split(token).flatMap((part, index): ReadonlyArray<AnswerSegment> => {
    if (index % 2 === 0) return part === "" ? [] : [{ kind: "text", text: part }];
    return part.startsWith("f")
      ? [{ kind: "figure", id: FigureId.make(part) }]
      : [{ kind: "record", id: RecordId.make(part) }];
  });
}

// Lines of a paragraph, or the items of a list.
type Run = { readonly list: boolean; readonly lines: Array<string> };

// The answer grammar: blank lines separate paragraphs, lines that start with "- " form a
// list, and `[[f1]]` and `[[r1]]` cite a figure and a record. Lines of one paragraph
// join with a space. Everything else, markdown included, is text.
export function parseAnswer(text: string): ReadonlyArray<AnswerBlock> {
  const runs: Array<Run> = [];
  let open: Run | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") {
      open = undefined;
      continue;
    }
    const list = line.startsWith(bullet);
    const content = list ? line.slice(bullet.length).trim() : line;
    if (open?.list === list) open.lines.push(content);
    else {
      open = { list, lines: [content] };
      runs.push(open);
    }
  }
  return runs.map(({ list, lines }) =>
    list
      ? { kind: "list", items: lines.map(segmentsOf) }
      : { kind: "paragraph", segments: segmentsOf(lines.join(" ")) },
  );
}

// Every segment of the answer grammar's text in order, list items included.
export function answerSegments(text: string): ReadonlyArray<AnswerSegment> {
  return parseAnswer(text).flatMap((block) =>
    block.kind === "list" ? block.items.flat() : block.segments,
  );
}
