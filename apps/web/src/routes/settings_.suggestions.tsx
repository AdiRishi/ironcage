import { createFileRoute } from "@tanstack/react-router";

import { SuggestionsPage } from "@/features/classification/suggestions";
export const Route = createFileRoute("/settings_/suggestions")({ component: SuggestionsPage });
