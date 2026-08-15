import { Schema } from "effect";

import { uuidV7 } from "../values/uuid";

export const ReportId = uuidV7("ReportId");
export type ReportId = typeof ReportId.Type;

export const ReportType = Schema.Literals(["monthly_spending"]);
export type ReportType = typeof ReportType.Type;
