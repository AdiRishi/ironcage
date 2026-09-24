import type { FinanceError, Institution, ParsedFile, SourceFormat } from "@repo/contracts/finance";
import type { Effect } from "effect";

import { parseCsv } from "./csv.ts";
import { parseOfx } from "./ofx.ts";
import { parsePdf } from "./pdf/index.ts";

export { parseCsv, parseOfx, parsePdf };

// The parser for each institution's file formats. A CSV carries no account identity,
// so it reads amounts in the chosen account's currency.
export const sourceParsers = {
  commbank: {
    csv: ({ bytes, currency }) => parseCsv(bytes, currency),
    ofx: ({ bytes }) => parseOfx(bytes),
    pdf: ({ bytes }) => parsePdf(bytes),
  },
} satisfies Record<
  Institution,
  Record<
    typeof SourceFormat.Type,
    (input: { bytes: Uint8Array; currency: string }) => Effect.Effect<ParsedFile, FinanceError>
  >
>;
