export const workerCompatibility = {
  date: "2026-07-11",
  flags: ["nodejs_compat"] satisfies Array<"nodejs_compat">,
};

export const workerObservability = {
  enabled: true,
  logs: { enabled: true, invocationLogs: true, headSamplingRate: 1 },
  traces: { enabled: true, headSamplingRate: 0.01 },
} as const;
