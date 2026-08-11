import { createFileRoute } from "@tanstack/react-router";

import { ReportLibrary } from "@/features/reports/components/report-library";

export const Route = createFileRoute("/reports/")({ component: ReportLibrary });
