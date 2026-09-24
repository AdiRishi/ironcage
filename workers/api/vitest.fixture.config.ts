import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["tests/**/*.fixture.ts"], testTimeout: 120_000 },
});
