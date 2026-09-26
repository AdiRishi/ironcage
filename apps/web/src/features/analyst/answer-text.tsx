import { type Answer, type AnswerSegment, parseAnswer } from "@repo/contracts/analyst";
import { Link } from "@tanstack/react-router";

import { FigureLink } from "./figure-link";
import { recordLink } from "./record-link";

// The figures and records an answer cites, by ID.
export const citationsOf = ({ figures, records }: Pick<Answer, "figures" | "records">) => ({
  figures: new Map(figures.map((figure) => [figure.id, figure])),
  records: new Map(records.map((record) => [record.id, record])),
});
export type Citations = ReturnType<typeof citationsOf>;

// Text in the answer grammar, with each token shown as the figure or record it cites. The
// rest stays text, so nothing the model wrote becomes a link or markup.
export function AnswerText({ text, cited }: { text: string; cited: Citations }) {
  return parseAnswer(text).map((block, index) =>
    block.kind === "paragraph" ? (
      <p key={index}>
        <Segments segments={block.segments} cited={cited} />
      </p>
    ) : (
      <ul key={index} className="list-disc space-y-1 pl-5">
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>
            <Segments segments={item} cited={cited} />
          </li>
        ))}
      </ul>
    ),
  );
}

function Segments({
  segments,
  cited,
}: {
  segments: ReadonlyArray<AnswerSegment>;
  cited: Citations;
}) {
  return segments.map((segment, index) => <Segment key={index} segment={segment} cited={cited} />);
}

// A turn keeps every figure and record its answer cites.
function Segment({ segment, cited }: { segment: AnswerSegment; cited: Citations }) {
  switch (segment.kind) {
    case "text":
      return segment.text;
    case "figure": {
      const figure = cited.figures.get(segment.id);
      return figure && <FigureLink figure={figure} />;
    }
    case "record": {
      const record = cited.records.get(segment.id);
      return (
        record && (
          <Link
            {...recordLink(record.records)}
            className="underline decoration-rule decoration-2 underline-offset-4 hover:decoration-intaglio"
          >
            {record.label}
          </Link>
        )
      );
    }
  }
}
