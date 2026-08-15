import {
  GetReportInput,
  MarkReportOpenedInput,
  MonthlySpendingReport,
  ReportSummary,
} from "@ironcage/contracts/schema";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { decodePayload, encodedRead, intoOutcome } from "@/server/boundary";
import { callCore } from "@/server/core.server";

export const listReports = createServerFn().handler(() =>
  callCore((client) => encodedRead(Schema.Array(ReportSummary))(client.listReports())),
);

export const getReport = createServerFn()
  .validator(decodePayload(GetReportInput))
  .handler(({ data }) =>
    callCore((client) => encodedRead(MonthlySpendingReport)(client.getReport(data))),
  );

export const markReportOpened = createServerFn({ method: "POST" })
  .validator(decodePayload(MarkReportOpenedInput))
  .handler(({ data }) =>
    callCore((client) => intoOutcome(ReportSummary)(client.markReportOpened(data))),
  );
