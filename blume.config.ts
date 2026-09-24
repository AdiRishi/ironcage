import { defineConfig } from "blume";

import { name } from "./package.json";

export default defineConfig({
  title: name
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" "),
  description: "Vision, product, design, and reference for Ironcage.",
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
      { label: "Product", path: "/product", icon: "panels-top-left" },
      { label: "Design", path: "/design", icon: "palette" },
      { label: "Reference", path: "/reference", icon: "network" },
      { label: "Roadmap", path: "/roadmap", icon: "map" },
      { label: "Glossary", path: "/glossary", icon: "book-a" },
      { label: "Vision", path: "/vision", icon: "compass" },
    ],
    sidebar: { display: "group" },
  },
  redirects: [
    { from: "/stages", to: "/roadmap" },
    { from: "/technical", to: "/reference" },
    { from: "/technical/architecture", to: "/reference/architecture" },
    { from: "/technical/financial-model", to: "/reference/ledger" },
    { from: "/technical/import-protocol", to: "/reference/imports" },
    { from: "/technical/calculation-rules", to: "/reference/analysis" },
    { from: "/technical/ai", to: "/reference/ai" },
    { from: "/technical/frontend", to: "/reference/frontend" },
    { from: "/technical/operations", to: "/reference/operations" },
    { from: "/technical/verification", to: "/reference/verification" },
  ],
  theme: {
    mode: "system",
  },
});
