"use agent";

import { useDataWriter, useInitialData, useModel, useTool } from "@flue/runtime";
import { env } from "cloudflare:workers";
import * as v from "valibot";

import {
  categorizationInitialDataSchema,
  categorizationInstructions,
  categorizationOutputSchema,
  categorizationResultSchema,
} from "../shared/categorization";

export function CategorizationAgent() {
  const input = useInitialData<v.InferOutput<typeof categorizationInitialDataSchema>>();
  if (input === undefined) throw new Error("categorization initial data is required");

  useModel(input.model, { thinkingLevel: "high" });
  const writeResult = useDataWriter("categorization", { schema: categorizationResultSchema });
  useTool({
    name: "submit_categorizations",
    description: "Submit the final category for every transaction exactly once, then end the run.",
    input: categorizationOutputSchema,
    async run({ data }) {
      writeResult({
        suggestions: data.suggestions,
        gatewayLogId: env.AI.aiGatewayLogId ?? null,
      });
      return { output: { accepted: true }, terminate: true };
    },
  });

  return categorizationInstructions(input);
}

CategorizationAgent.agentName = "categorization";
CategorizationAgent.initialData = categorizationInitialDataSchema;
