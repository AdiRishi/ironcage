import { describe, expect, it } from "vitest";

import { cloudflareResourceNames, type CloudflareResourceNames } from "../src/resource-names.ts";

const values = (names: CloudflareResourceNames): string[] => [
  ...Object.values(names.workers),
  ...Object.values(names.hyperdrive),
  ...Object.values(names.buckets),
  ...Object.values(names.queues),
  names.aiGateway,
  names.flags,
];

describe("Cloudflare resource names", () => {
  it("keeps deployed development resources outside the production namespace", () => {
    const production = values(cloudflareResourceNames("prod"));
    const development = values(cloudflareResourceNames("dev"));

    expect(new Set(production).intersection(new Set(development))).toEqual(new Set());
    expect(development.every((name) => name.endsWith("-dev"))).toBe(true);
  });

  it("preserves the production resource names", () => {
    expect(cloudflareResourceNames("prod")).toEqual({
      workers: {
        app: "ironcage-app",
        core: "ironcage-core",
        agents: "ironcage-agents",
        compute: "ironcage-compute",
      },
      hyperdrive: {
        cached: "ironcage-with-cache",
        uncached: "ironcage-without-cache",
      },
      buckets: {
        blobs: "ironcage-private",
        agentArtifacts: "ironcage-agent-artifacts",
        backups: "ironcage-backups",
      },
      queues: {
        decisionRecords: "ironcage-decision-records",
        decisionRecordDeadLetters: "ironcage-decision-records-dlq",
      },
      aiGateway: "ironcage",
      flags: "ironcage",
    });
  });
});
