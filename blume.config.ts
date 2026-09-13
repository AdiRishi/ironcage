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
      { label: "Vision", path: "/vision", icon: "compass" },
      { label: "Product", path: "/product", icon: "panels-top-left" },
      { label: "Technical", path: "/technical", icon: "network" },
    ],
    sidebar: { display: "group" },
  },
  theme: {
    mode: "system",
  },
});
