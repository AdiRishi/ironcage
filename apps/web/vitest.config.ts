import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [tailwindcss(), viteReact()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/**/*.test.ts"],
        },
      },
      {
        extends: true,
        // Register server-function mocks before Vite follows their Worker-only imports.
        server: { preTransformRequests: false },
        optimizeDeps: {
          exclude: ["@/server/api-client.server", "@/server/analyst-client.server"],
        },
        test: {
          name: "components",
          include: ["tests/**/*.test.tsx"],
          setupFiles: ["./tests/setup.ts"],
          browser: {
            enabled: true,
            headless: true,
            // East of UTC, a local midnight read through UTC falls on the day before.
            provider: playwright({ contextOptions: { timezoneId: "Australia/Sydney" } }),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
