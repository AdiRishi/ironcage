import { describe, expect, it } from "@effect/vitest";
import { FigureId, parseAnswer, RecordId } from "@repo/contracts/analyst";

const text = (value: string) => ({ kind: "text", text: value }) as const;
const figure = (id: string) => ({ kind: "figure", id: FigureId.make(id) }) as const;
const record = (id: string) => ({ kind: "record", id: RecordId.make(id) }) as const;

describe("parseAnswer", () => {
  it("cites figures and records where their tokens stand in the text", () => {
    expect(parseAnswer("Dining out rose [[f3]] to [[f12]], most of it at [[r2]].")).toEqual([
      {
        kind: "paragraph",
        segments: [
          text("Dining out rose "),
          figure("f3"),
          text(" to "),
          figure("f12"),
          text(", most of it at "),
          record("r2"),
          text("."),
        ],
      },
    ]);
  });

  it("reads blank lines as paragraph breaks and dashed lines as one list", () => {
    const answer = [
      "Spending rose [[f1]] in August.",
      "Most of it was dining out.",
      "",
      "The largest changes:",
      "- Dining out, [[f2]]",
      "  -   Travel, [[f3]]\r",
      "Nothing else changed.",
    ].join("\n");
    expect(parseAnswer(answer)).toEqual([
      {
        kind: "paragraph",
        segments: [
          text("Spending rose "),
          figure("f1"),
          text(" in August. Most of it was dining out."),
        ],
      },
      { kind: "paragraph", segments: [text("The largest changes:")] },
      {
        kind: "list",
        items: [
          [text("Dining out, "), figure("f2")],
          [text("Travel, "), figure("f3")],
        ],
      },
      { kind: "paragraph", segments: [text("Nothing else changed.")] },
    ]);
  });

  it("keeps anything that is not a whole token as text", () => {
    const answer = "[[f0]] [[x1]] [f1] [[ f1 ]] [[f1] [see](https://example.com) * item";
    expect(parseAnswer(answer)).toEqual([{ kind: "paragraph", segments: [text(answer)] }]);
  });
});
