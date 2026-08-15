import { toMarkdownBytes } from "@firecrawl/anydoc";

export const extractor = { package: "@firecrawl/anydoc", version: "0.1.9" } as const;

export const extractStatement = async (pdf: Uint8Array) => ({
  markdown: await toMarkdownBytes(pdf),
  extractor,
});
