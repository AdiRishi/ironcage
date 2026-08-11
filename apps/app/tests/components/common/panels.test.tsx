import { Internal, Stale } from "@ironcage/contracts/schema";
import { BankAccountId, CalendarDate, type MoneyCoverage } from "@ironcage/domain";
import { render, screen } from "@testing-library/react";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { CallFailure, CoverageNotice } from "@/components/common/panels";
import { CoreCallFailed } from "@/data/core-call";

const accountId = Schema.decodeUnknownSync(BankAccountId)("018f0000-0000-7000-8000-000000004001");
const date = Schema.decodeUnknownSync(CalendarDate);
const labels = new Map([[accountId as string, "Spending offset"]]);

describe("CoverageNotice", () => {
  it("says nothing when the month is complete", () => {
    const { container } = render(
      <CoverageNotice coverage={{ _tag: "Complete" }} accountLabels={labels} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("names the missing window by account rather than implying no spending", () => {
    const coverage: MoneyCoverage = {
      _tag: "Incomplete",
      gaps: [{ accountId, start: date("2026-03-15"), end: date("2026-03-17") }],
    };

    render(<CoverageNotice coverage={coverage} accountLabels={labels} />);

    expect(screen.getByText(/not complete/i)).toBeInTheDocument();
    expect(screen.getByText(/Spending offset · 15 Mar 2026 to 17 Mar 2026/)).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });
});

describe("CallFailure", () => {
  it("renders the reason core sent, not a stack trace", () => {
    render(
      <CallFailure
        error={
          new CoreCallFailed(
            new Stale({
              reason: "PreviewStale",
              detail: "the transaction record changed after preview",
            }),
          )
        }
      />,
    );

    expect(screen.getByText("PreviewStale")).toBeInTheDocument();
    expect(screen.getByText(/changed after preview/)).toBeInTheDocument();
  });

  it("keeps an unrecognised failure legible instead of blank", () => {
    render(
      <CallFailure error={new CoreCallFailed(new Internal({ detail: "commit transaction" }))} />,
    );

    expect(screen.getByText(/could not be read/i)).toBeInTheDocument();
    expect(screen.getByText("commit transaction")).toBeInTheDocument();
  });
});
