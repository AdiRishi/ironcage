import { defineConfig } from "blume";

export default defineConfig({
  title: "Ironcage",
  description:
    "A personal wealth operating system: one engine running many investment strategies, every one caged by deterministic risk rules, every one earning its capital through evidence.",
  logo: {
    image: "/ironcage-icon.png",
    text: "Ironcage",
  },
  github: {
    owner: "AdiRishi",
    repo: "ironcage",
  },
  deployment: {
    site: "https://adirishi.github.io",
    base: "/ironcage",
  },
  lastModified: true,
  theme: {
    accent: { light: "#c2410c", dark: "#e2632e" },
    radius: "md",
    mode: "system",
  },
  navigation: {
    tabs: [
      { label: "Foundations", path: "/", icon: "landmark" },
      { label: "Product", path: "/product", icon: "layout-dashboard" },
      { label: "Technical", path: "/technical", icon: "cpu" },
    ],
  },
});
