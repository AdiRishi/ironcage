import { type ModelSettings, type ModelUsage, UpdateModelSettings } from "@repo/contracts/finance";
import { QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query";
import { Effect, Schema } from "effect";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";

import { AnalystSettings } from "@/features/analyst/settings";
import {
  listCategoryProposals,
  listEnrichmentRuns,
  requestEnrichment,
  requestEvaluation,
  resolveCategoryProposal,
} from "@/features/enrichment/functions";
import { EnrichmentSection } from "@/features/enrichment/settings";
import { getModelSettings, getModelUsage, updateModelSettings } from "@/features/models/functions";
import { modelSettingsQuery, modelUsageQuery } from "@/features/models/queries";
import { ModelUsageSection } from "@/features/models/usage";
import { AppRequestError } from "@/lib/app-error";
import { createQueryClient } from "@/lib/query-client";

// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/models/functions", () => ({
  getModelSettings: vi.fn<typeof getModelSettings>(),
  updateModelSettings: vi.fn<typeof updateModelSettings>(),
  getModelUsage: vi.fn<typeof getModelUsage>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/enrichment/functions", () => ({
  listEnrichmentRuns: vi.fn<typeof listEnrichmentRuns>(),
  requestEnrichment: vi.fn<typeof requestEnrichment>(),
  requestEvaluation: vi.fn<typeof requestEvaluation>(),
  listCategoryProposals: vi.fn<typeof listCategoryProposals>(),
  resolveCategoryProposal: vi.fn<typeof resolveCategoryProposal>(),
}));

const enrichmentProvider = {
  name: "Cloudflare Workers AI",
  model: "@cf/zai-org/glm-5.3-flash",
  inputMicrousdPerMillion: 150_000n,
  cachedInputMicrousdPerMillion: 30_000n,
  outputMicrousdPerMillion: 500_000n,
};
const analystProvider = {
  name: "Cloudflare Workers AI",
  model: "@cf/openai/gpt-oss-120b",
  inputMicrousdPerMillion: 350_000n,
  cachedInputMicrousdPerMillion: 350_000n,
  outputMicrousdPerMillion: 750_000n,
};
const usd = (minor: bigint) => ({ currency: "USD", minor });
const noUsage: typeof ModelUsage.Type = {
  calls: 0,
  inputTokens: 0n,
  outputTokens: 0n,
  unknownUsage: 0,
  costs: [],
  tasks: [],
  recent: [],
};

// Settings as the API keeps them: a save must expect the current version.
let stored: ModelSettings;
function storeSettings(usage = noUsage) {
  stored = {
    enrichment: { enabled: true, autoApplyConfidence: 0.8, provider: enrichmentProvider },
    analyst: { enabled: false, provider: analystProvider },
    warning: usd(2000n),
    version: 1,
  };
  vi.mocked(getModelSettings).mockImplementation(async () => stored);
  vi.mocked(getModelUsage).mockImplementation(async () => usage);
  vi.mocked(listEnrichmentRuns).mockImplementation(async () => []);
  vi.mocked(updateModelSettings).mockImplementation(async ({ data }) => {
    const update = await Effect.runPromise(Schema.decodeEffect(UpdateModelSettings)(data));
    if (update.expectedVersion !== stored.version)
      throw new AppRequestError("stale", "These settings changed. Review them and save again.");
    stored = {
      enrichment: { ...update.enrichment, provider: enrichmentProvider },
      analyst: { ...update.analyst, provider: analystProvider },
      warning: update.warning,
      version: stored.version + 1,
    };
    return stored;
  });
}

// The model parts of the Settings screen, in the order the screen shows them.
function ModelSettingsParts() {
  const { data: settings } = useSuspenseQuery(modelSettingsQuery());
  const { data: usage } = useSuspenseQuery(modelUsageQuery());
  return (
    <>
      <ModelUsageSection usage={usage} settings={settings} />
      <EnrichmentSection settings={settings} />
      <AnalystSettings settings={settings} />
    </>
  );
}

async function renderParts(onTestFinished: (cleanup: () => Promise<void>) => void) {
  const client = createQueryClient();
  await Promise.all([
    client.prefetchQuery(modelSettingsQuery()),
    client.prefetchQuery(modelUsageQuery()),
  ]);
  const screen = await render(
    <QueryClientProvider client={client}>
      <ModelSettingsParts />
    </QueryClientProvider>,
  );
  onTestFinished(async () => {
    await screen.unmount();
    client.clear();
    vi.mocked(getModelSettings).mockReset();
    vi.mocked(getModelUsage).mockReset();
    vi.mocked(updateModelSettings).mockReset();
    vi.mocked(listEnrichmentRuns).mockReset();
  });
  return { screen, client };
}

test("model usage lists what each task used, with usage no call reported as unknown", async ({
  onTestFinished,
}) => {
  storeSettings({
    calls: 9,
    inputTokens: 5400n,
    outputTokens: 900n,
    unknownUsage: 3,
    costs: [usd(62n)],
    tasks: [
      {
        task: "enrichment",
        calls: 4,
        inputTokens: 3000n,
        outputTokens: 500n,
        unknownUsage: 0,
        costs: [usd(40n)],
      },
      {
        task: "analyst",
        calls: 3,
        inputTokens: 2400n,
        outputTokens: 400n,
        unknownUsage: 1,
        costs: [usd(22n)],
      },
      {
        task: "categorisation",
        calls: 2,
        inputTokens: null,
        outputTokens: null,
        unknownUsage: 2,
        costs: [],
      },
    ],
    recent: [],
  });
  const { screen } = await renderParts(onTestFinished);

  await expect
    .element(screen.getByText("So far:", { exact: false }))
    .toHaveTextContent(
      "So far: 9 calls · 5,400 input tokens · 900 output tokens · recorded cost 0.62 USD.",
    );
  await expect
    .element(screen.getByText("3 calls have incomplete usage reports", { exact: false }))
    .toHaveTextContent(
      "3 calls have incomplete usage reports, and the totals count only what was reported.",
    );
  const table = screen.getByRole("table", { name: "Model usage by task" });
  expect(
    table
      .getByRole("row")
      .elements()
      .map((row) => [...row.children].map((cell) => cell.textContent)),
  ).toEqual([
    ["Task", "Calls", "Incomplete reports", "Input tokens", "Output tokens", "Recorded cost"],
    ["Counterparty identification", "4", "0", "3,000", "500", "0.40 USD"],
    ["Analyst questions", "3", "1", "2,400", "400", "0.22 USD"],
    ["categorisation", "2", "2", "Unknown", "Unknown", "Unknown"],
  ]);
  await expect.element(table.getByRole("rowheader", { name: "Analyst questions" })).toBeVisible();
  const warning = screen.getByLabelText("Usage warning (USD)");
  await expect.element(warning).toHaveValue("20.00");
  await expect
    .element(warning)
    .toHaveAccessibleDescription(
      "Once the recorded cost of every task together reaches it, no task calls the model until you raise it. Leave it empty for no warning.",
    );
});

test("turning off counterparty identification leaves the analyst and the warning as they were", async ({
  onTestFinished,
}) => {
  storeSettings();
  const { screen } = await renderParts(onTestFinished);

  await screen.getByRole("checkbox", { name: "Identify counterparties with the model" }).click();
  await screen.getByRole("button", { name: "Save identification settings" }).click();
  await expect.element(screen.getByText("Identification settings saved.")).toBeVisible();
  expect(stored).toMatchObject({
    enrichment: { enabled: false, autoApplyConfidence: 0.8 },
    analyst: { enabled: false },
    warning: usd(2000n),
    version: 2,
  });
  await expect
    .element(screen.getByRole("button", { name: "Identify new counterparties" }))
    .toBeDisabled();
  await expect
    .element(screen.getByRole("checkbox", { name: "Identify counterparties with the model" }))
    .not.toBeChecked();
});

test("the analyst is off and says what it sends the model before you turn it on", async ({
  onTestFinished,
}) => {
  storeSettings();
  const { screen } = await renderParts(onTestFinished);

  await expect
    .element(
      screen.getByRole("checkbox", {
        name: "Answer questions and write monthly briefings with the model",
      }),
    )
    .not.toBeChecked();
  await expect
    .element(screen.getByText("The analyst answers questions", { exact: false }))
    .toHaveTextContent(
      "The analyst answers questions about your money in plain language, and writes a briefing of each month once it ends. Cloudflare Workers AI runs @cf/openai/gpt-oss-120b. For each question and each month's briefing, the analyst sends the model the figures, dates, bank descriptions, and counterparty, category, tag, personal event, and account labels it works from, and the names of your files and any problems importing them. The analyst never sends account numbers or balances.",
    );
});

test("turning on the analyst after the settings changed elsewhere asks you to review them first", async ({
  onTestFinished,
}) => {
  storeSettings();
  const { screen, client } = await renderParts(onTestFinished);

  const analyst = screen.getByRole("checkbox", {
    name: "Answer questions and write monthly briefings with the model",
  });
  await analyst.click();
  stored = { ...stored, warning: usd(3000n), version: 2 };
  await client.invalidateQueries({ queryKey: modelSettingsQuery().queryKey });
  await screen.getByRole("button", { name: "Save analyst setting" }).click();
  await expect.element(screen.getByRole("alert")).toMatchTextContent("Now: the analyst is off.");
  expect(stored.analyst.enabled).toBe(false);
  await expect.element(analyst).toBeChecked();

  await screen.getByRole("button", { name: "Keep my edits" }).click();
  const save = screen.getByRole("button", { name: "Save analyst setting" });
  await expect.element(save).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await expect.element(screen.getByText("Analyst setting saved.")).toBeVisible();
  expect(stored).toMatchObject({
    analyst: { enabled: true },
    warning: usd(3000n),
    version: 3,
  });
});

test("a warning typed while the settings changed elsewhere stays in the field until you save it over them", async ({
  onTestFinished,
}) => {
  storeSettings();
  const { screen, client } = await renderParts(onTestFinished);

  const warning = screen.getByLabelText("Usage warning (USD)");
  await warning.fill("35.00");
  stored = {
    ...stored,
    analyst: { enabled: true, provider: analystProvider },
    warning: usd(3000n),
    version: 2,
  };
  await client.invalidateQueries({ queryKey: modelSettingsQuery().queryKey });
  await screen.getByRole("button", { name: "Save warning" }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent("Now: a warning at 30.00 USD. Your edits are still in the form.");
  expect(stored.warning).toEqual(usd(3000n));
  await expect.element(warning).toHaveValue("35.00");

  await screen.getByRole("button", { name: "Keep my edits" }).click();
  await screen.getByRole("button", { name: "Save warning" }).click();
  await expect.element(screen.getByText("Warning saved.")).toBeVisible();
  expect(stored).toMatchObject({
    analyst: { enabled: true },
    warning: usd(3500n),
    version: 3,
  });
});

test("saving the warning and then the analyst keeps both without asking you to review", async ({
  onTestFinished,
}) => {
  storeSettings();
  const { screen } = await renderParts(onTestFinished);

  await screen.getByLabelText("Usage warning (USD)").fill("35.00");
  await screen.getByRole("button", { name: "Save warning" }).click();
  await expect.element(screen.getByText("Warning saved.")).toBeVisible();
  await screen
    .getByRole("checkbox", { name: "Answer questions and write monthly briefings with the model" })
    .click();
  await screen.getByRole("button", { name: "Save analyst setting" }).click();
  await expect.element(screen.getByText("Analyst setting saved.")).toBeVisible();
  expect(stored).toMatchObject({
    analyst: { enabled: true },
    warning: usd(3500n),
    version: 3,
  });
});

test("a saved setting stays shown when the settings cannot be loaded again", async ({
  onTestFinished,
}) => {
  storeSettings();
  const { screen } = await renderParts(onTestFinished);
  vi.mocked(getModelSettings).mockImplementation(async () => {
    throw new AppRequestError("internal", "The service could not complete the request.");
  });

  const analyst = screen.getByRole("checkbox", {
    name: "Answer questions and write monthly briefings with the model",
  });
  await analyst.click();
  await screen.getByRole("button", { name: "Save analyst setting" }).click();
  await expect.element(screen.getByText("Analyst setting saved.")).toBeVisible();
  await expect.element(analyst).toBeChecked();

  await screen.getByLabelText("Usage warning (USD)").fill("35.00");
  await screen.getByRole("button", { name: "Save warning" }).click();
  await expect.element(screen.getByText("Warning saved.")).toBeVisible();
  expect(stored).toMatchObject({
    analyst: { enabled: true },
    warning: usd(3500n),
    version: 3,
  });
  await expect.element(analyst).toBeChecked();
});
