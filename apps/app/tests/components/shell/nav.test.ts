import { describe, expect, it } from "vitest";

import { activeSection, NAV_SECTIONS } from "@/components/shell/nav";

describe("NAV_SECTIONS", () => {
  it("numbers the eight surfaces sequentially", () => {
    expect(NAV_SECTIONS.map((section) => section.ordinal)).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
    ]);
  });

  it("gives every section a distinct match prefix", () => {
    const prefixes = NAV_SECTIONS.map((section) => section.match);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("keeps every tab inside its own section", () => {
    for (const section of NAV_SECTIONS) {
      for (const tab of section.tabs) {
        expect(tab.to?.startsWith(section.match)).toBe(true);
      }
    }
  });
});

describe("activeSection", () => {
  it("resolves a surface's own path", () => {
    expect(activeSection("/money").label).toBe("Money");
    expect(activeSection("/workbench").label).toBe("Workbench");
  });

  it("resolves a path nested under a surface", () => {
    expect(activeSection("/portfolio/cage").label).toBe("Portfolio");
    expect(activeSection("/sleeves/crypto-trend/mandate").label).toBe("Sleeves");
    expect(activeSection("/tax/report/2026").label).toBe("Tax");
  });

  it("resolves the root to Overview", () => {
    expect(activeSection("/").label).toBe("Overview");
  });

  // Overview's `/` prefixes every path, so a naive prefix match would claim
  // all of them. It has to be the fallback instead.
  it("does not let Overview claim another surface's path", () => {
    expect(activeSection("/activity").label).not.toBe("Overview");
  });

  // The ceremony mounts over any surface and belongs to none of them.
  it("falls back to Overview for a path outside every surface", () => {
    expect(activeSection("/decide/promotion/eth-breakout").label).toBe("Overview");
  });

  it("does not match a surface on a shared prefix", () => {
    expect(activeSection("/taxidermy").label).toBe("Overview");
  });
});
