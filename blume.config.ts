import { defineConfig } from "blume";

import { name } from "./package.json";

export default defineConfig({
  title: name
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" "),
  description: "Delivery stages, product behavior, and technical architecture for Ironcage.",
  github: {
    owner: "AdiRishi",
    repo: "ironcage",
  },
  deployment: {
    site: "https://adirishi.github.io",
    base: "/ironcage",
  },
  navigation: {
    tabs: [
      { label: "Stages", path: "/stages", icon: "list-checks" },
      { label: "Product", path: "/product", icon: "panels-top-left" },
      { label: "Technical", path: "/technical", icon: "network" },
      { label: "Glossary", path: "/glossary", icon: "book-a" },
      { label: "Vision", path: "/vision", icon: "compass" },
    ],
    sidebar: { display: "group" },
  },
  redirects: [
    { from: "/technical/build-spend-management", to: "/stages" },
    { from: "/technical/stage-boundaries", to: "/stages" },
    { from: "/technical/monorepo", to: "/technical/architecture" },
    { from: "/technical/rpc", to: "/technical/architecture" },
    { from: "/technical/contracts", to: "/technical/financial-model" },
    { from: "/technical/database-schema", to: "/technical/financial-model" },
    { from: "/technical/ingestion", to: "/technical/import-protocol" },
    { from: "/technical/analytics", to: "/technical/calculation-rules" },
    { from: "/technical/ai-analyst", to: "/technical/ai" },
    { from: "/technical/ai-functionality", to: "/technical/ai" },
  ],
  theme: {
    mode: "system",
  },
});
