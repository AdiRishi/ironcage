import { createFileRoute } from "@tanstack/react-router";

import { RulesPage } from "@/features/rules/page";
export const Route = createFileRoute("/settings_/rules")({ component: RulesPage });
