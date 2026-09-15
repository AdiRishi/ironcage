import type { Locator, SourceFileId } from "@repo/contracts/finance";

export const sourceHref = (
  sourceFileId: typeof SourceFileId.Type,
  locator?: typeof Locator.Type,
) =>
  locator?.kind === "pdfRow"
    ? `/sources/${sourceFileId}#page=${locator.page}`
    : `/sources/${sourceFileId}`;

export const locatorLabel = (locator: typeof Locator.Type) =>
  locator.kind === "csvLine"
    ? `CSV line ${locator.line}`
    : locator.kind === "ofxTransaction"
      ? `OFX transaction ${locator.ordinal}`
      : `Page ${locator.page}, row ${locator.row}`;
