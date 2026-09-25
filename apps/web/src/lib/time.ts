import type { Instant } from "@repo/contracts/finance";
import { DateTime } from "effect";

// When something happened, such as "25 Sept 2026, 4:32 pm", in the settings timezone, so
// the server and the browser print the same words.
export const instantLabel = (instant: Instant, timeZone: string) =>
  DateTime.format(DateTime.makeUnsafe(instant), {
    locale: "en-AU",
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
