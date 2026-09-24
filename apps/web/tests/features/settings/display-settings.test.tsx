import type { Settings } from "@repo/contracts/finance";
import { QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { DisplaySettings } from "@/features/settings/display-settings";
import {
  getSettings,
  updateSettings,
  getRetention,
  getModelUsage,
} from "@/features/settings/functions";
import { settingsQueryOptions } from "@/features/settings/queries";
import { AppRequestError } from "@/lib/app-error";
import { createQueryClient } from "@/lib/query-client";

// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/settings/functions", () => ({
  getSettings: vi.fn<typeof getSettings>(),
  updateSettings: vi.fn<typeof updateSettings>(),
  getRetention: vi.fn<typeof getRetention>(),
  getModelUsage: vi.fn<typeof getModelUsage>(),
}));

function SettingsEditor() {
  const { data } = useSuspenseQuery(settingsQueryOptions());
  return <DisplaySettings settings={data} />;
}

test("a background refresh cannot save an older settings draft without reviewing current values", async ({
  onTestFinished,
}) => {
  let stored: Settings = { timezone: "Australia/Sydney", reportingCurrency: "AUD", version: 1 };
  vi.mocked(getSettings).mockImplementation(async () => stored);
  vi.mocked(updateSettings).mockImplementation(async ({ data }) => {
    if (data.expectedVersion !== stored.version)
      throw new AppRequestError("stale", "Settings changed. Refresh before saving.");
    stored = {
      timezone: data.timezone,
      reportingCurrency: data.reportingCurrency,
      version: stored.version + 1,
    };
    return stored;
  });
  const client = createQueryClient();
  client.setQueryData(settingsQueryOptions().queryKey, stored);
  const screen = await render(
    <QueryClientProvider client={client}>
      <SettingsEditor />
    </QueryClientProvider>,
  );
  onTestFinished(async () => {
    await screen.unmount();
    client.clear();
    vi.mocked(getSettings).mockReset();
    vi.mocked(updateSettings).mockReset();
  });

  const timezone = screen.getByLabelText("Display timezone");
  await timezone.fill("Europe/London");
  stored = { timezone: "Asia/Tokyo", reportingCurrency: "JPY", version: 2 };
  await client.invalidateQueries({ queryKey: settingsQueryOptions().queryKey });
  await screen.getByRole("button", { name: "Save display settings" }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent("Current settings: Asia/Tokyo · JPY.");
  expect(stored).toEqual({ timezone: "Asia/Tokyo", reportingCurrency: "JPY", version: 2 });
  await expect.element(timezone).toHaveValue("Europe/London");

  await screen.getByRole("button", { name: "Keep my edits" }).click();
  await screen.getByRole("button", { name: "Save display settings" }).click();
  await expect.element(screen.getByRole("status")).toHaveTextContent("Display settings saved.");
  expect(stored).toEqual({ timezone: "Europe/London", reportingCurrency: "AUD", version: 3 });

  await timezone.fill("Europe/Paris");
  await screen.getByRole("button", { name: "Save display settings" }).click();
  await expect.poll(() => stored.timezone).toBe("Europe/Paris");
});
