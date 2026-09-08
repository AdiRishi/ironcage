import { defineConfig } from "blume";

import { name } from "./package.json";

export default defineConfig({
  title: name
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" "),
  description: "The vision, product experience, and technical design of Ironcage.",
  navigation: {
    tabs: [
      { label: "Vision", path: "/vision", icon: "compass" },
      { label: "Product", path: "/product", icon: "panels-top-left" },
      { label: "Technical", path: "/technical", icon: "network" },
    ],
    sidebar: { display: "group" },
  },
  theme: {
    accent: { light: "#0f766e", dark: "#2dd4bf" },
    mode: "system",
  },
});
