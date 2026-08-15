import type { LinkProps } from "@tanstack/react-router";

/**
 * Every path the shell navigates to. `LinkProps["to"]` resolves through the
 * router's `Register` interface, so a manifest entry pointing at a route that
 * does not exist fails `tsc` rather than 404-ing at runtime. That is the whole
 * reason the manifest is typed instead of being a list of strings.
 */
export type AppPath = NonNullable<LinkProps["to"]>;

export type SurfaceTab = {
  readonly label: string;
  readonly to: AppPath;
  /** A live count the tab surfaces beside its label, when the section has one. */
  readonly count?: "moneyReview";
};

export type NavSection = {
  /** The ordinal printed beside the label in the sidebar. */
  readonly ordinal: string;
  readonly label: string;
  readonly to: AppPath;
  /** Path prefix that marks this section active. */
  readonly match: string;
  /** The section's one-line stance, printed beside its name in the top bar. */
  readonly tagline?: string;
  readonly tabs: readonly SurfaceTab[];
};

/**
 * The eight destinations, in the order the design numbers them. This is the
 * single source for the sidebar, the top bar's title, and each surface's tab
 * strip — the three cannot disagree because there is only one list.
 *
 * The route tree these point into is specified in `docs/technical/11-app.md`
 * §1. Detail routes (a trade story, one report, the ceremony) are deliberately
 * absent: they are reached from a surface, not from navigation.
 */
const OVERVIEW: NavSection = {
  ordinal: "01",
  label: "Overview",
  to: "/",
  match: "/",
  tabs: [],
};

export const NAV_SECTIONS: readonly NavSection[] = [
  OVERVIEW,
  {
    ordinal: "02",
    label: "Sleeves",
    to: "/sleeves",
    match: "/sleeves",
    // A sleeve's own tabs live in the `$sleeveId` layout: they need the id,
    // so they cannot be resolved from a static manifest.
    tabs: [],
  },
  {
    ordinal: "03",
    label: "Activity",
    to: "/activity",
    match: "/activity",
    tabs: [],
  },
  {
    ordinal: "04",
    label: "Portfolio",
    to: "/portfolio",
    match: "/portfolio",
    tabs: [
      { label: "Book", to: "/portfolio" },
      { label: "Capital", to: "/portfolio/capital" },
      { label: "Transfers", to: "/portfolio/transfers" },
      { label: "Costs", to: "/portfolio/costs" },
      { label: "Cage", to: "/portfolio/cage" },
    ],
  },
  {
    ordinal: "05",
    label: "Money",
    to: "/money",
    match: "/money",
    tagline: "Reads everything · trades nothing",
    tabs: [
      { label: "Spending", to: "/money" },
      { label: "Import", to: "/money/import" },
      { label: "Review", to: "/money/review", count: "moneyReview" },
      { label: "Recurring", to: "/money/recurring" },
    ],
  },
  {
    ordinal: "06",
    label: "Reports",
    to: "/reports",
    match: "/reports",
    tabs: [],
  },
  {
    ordinal: "07",
    label: "Workbench",
    to: "/workbench",
    match: "/workbench",
    tabs: [
      { label: "Runs", to: "/workbench" },
      { label: "Data", to: "/workbench/data" },
      { label: "Research", to: "/workbench/research" },
    ],
  },
  {
    ordinal: "08",
    label: "Tax",
    to: "/tax",
    match: "/tax",
    tabs: [
      { label: "Estimate", to: "/tax" },
      { label: "Review", to: "/tax/review" },
    ],
  },
];

/**
 * The section a pathname belongs to. Overview is the fallback rather than a
 * prefix match, because its `/` would otherwise claim every path.
 */
export function activeSection(pathname: string): NavSection {
  return (
    NAV_SECTIONS.find(
      (section) =>
        section.match !== "/" &&
        (pathname === section.match || pathname.startsWith(`${section.match}/`)),
    ) ?? OVERVIEW
  );
}
