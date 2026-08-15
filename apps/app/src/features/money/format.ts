import type { BoundaryError, CoverageSpan } from "@ironcage/contracts/schema";
import type { CalendarDate } from "@ironcage/domain";
import { BigDecimal, DateTime } from "effect";

/**
 * Bank amounts stay `BigDecimal` all the way to the glass — formatting works
 * on digit strings, so a value near the numeric(20,8) ceiling renders exactly
 * rather than through a lossy `Number`. The typographic minus (U+2212) is
 * deliberate: it is a display glyph, full-width in IBM Plex Mono, and never
 * something a parser should accept back.
 */
const MINUS = "−";

type SignMode = "auto" | "always" | "none";

export const formatAud = (
  amount: BigDecimal.BigDecimal,
  { sign = "auto" }: { sign?: SignMode } = {},
): string => {
  const rounded = BigDecimal.round(amount, { scale: 2, mode: "half-even" });
  const negative = BigDecimal.isNegative(rounded);
  const [whole = "0", fraction = ""] = BigDecimal.format(BigDecimal.abs(rounded)).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const figure = `A$${grouped}.${`${fraction}00`.slice(0, 2)}`;

  if (sign === "none") return figure;
  if (negative) return `${MINUS}${figure}`;
  return sign === "always" ? `+${figure}` : figure;
};

/** "2025-07" → "July 2025". */
export const formatMonth = (month: string): string =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

/** "2025-08-05" → "5 Aug 2025". */
export const formatDay = (date: CalendarDate): string =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/** An inclusive date range, with the year stated once when it is shared. */
export const formatSpan = (span: CoverageSpan): string => {
  if (span.start === span.end) return formatDay(span.start);
  const sameYear = span.start.slice(0, 4) === span.end.slice(0, 4);
  const start = sameYear
    ? new Date(`${span.start}T00:00:00Z`).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })
    : formatDay(span.start);
  return `${start} – ${formatDay(span.end)}`;
};

/** How long ago an instant was, in the coarsest unit that still informs. */
export const formatAgo = (instant: DateTime.Utc, now: number = Date.now()): string => {
  const minutes = Math.floor((now - DateTime.toEpochMillis(instant)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes === 1 ? "a minute ago" : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
};

/** A savings rate like "0.6400" → "64%". Display only; never fed back. */
export const formatRate = (rate: string): string => `${Math.round(Number.parseFloat(rate) * 100)}%`;

/** A boundary error in the interface's voice: what happened, never a stack. */
export const describeError = (error: BoundaryError | Error): string => {
  if (!("_tag" in error)) return error.message;
  switch (error._tag) {
    case "NotFound":
      return `${error.entity} ${error.id} was not found.`;
    case "Internal":
      return error.detail;
    default:
      return error.detail === "" ? error.reason : error.detail;
  }
};

const CADENCES: ReadonlyArray<readonly [center: number, tolerance: number, label: string]> = [
  [7, 2, "Weekly"],
  [14, 3, "Fortnightly"],
  [30, 4, "Monthly"],
  [91, 7, "Quarterly"],
  [365, 10, "Yearly"],
];

/** The analysis cadence buckets from `docs/technical/08-money.md` §11. */
export const cadenceLabel = (days: number): string => {
  const bucket = CADENCES.find(([center, tolerance]) => Math.abs(days - center) <= tolerance);
  return bucket === undefined ? `Every ${days} days` : bucket[2];
};
